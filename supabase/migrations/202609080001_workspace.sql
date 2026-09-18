create extension if not exists vector with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  trial_ends_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create function public.create_quip_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles(id) values(new.id); return new; end $$;
create trigger quip_profile_created after insert on auth.users for each row execute function public.create_quip_profile();
insert into public.profiles(id, created_at, trial_ends_at) select id, created_at, created_at + interval '7 days' from auth.users on conflict do nothing;

create table public.projects (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
 name text not null check(length(name) between 1 and 160), instructions text not null default '' check(length(instructions)<=8000), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.conversations (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade, project_id uuid not null,
 title text not null check(length(title) between 1 and 160), updated_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade, unique(id,owner_id)
);
create table public.messages (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade, conversation_id uuid not null,
 role text not null check(role in ('user','assistant')), text text not null default '', status text not null default 'complete' check(status in ('complete','interrupted','error')),
 citations jsonb not null default '[]', created_at timestamptz not null default now(),
 foreign key(conversation_id,owner_id) references public.conversations(id,owner_id) on delete cascade
);
create table public.sources (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade, project_id uuid not null,
 name text not null, mime_type text not null, size bigint not null check(size between 1 and 20971520), kind text not null check(kind in ('document','image')),
 status text not null default 'indexing' check(status in ('indexing','ready','error')), error text, storage_path text not null unique, sections jsonb not null default '[]', created_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade, unique(id,owner_id)
);
create table public.source_chunks (
 id bigint generated always as identity primary key, source_id uuid not null, owner_id uuid not null references auth.users on delete cascade, project_id uuid not null,
 text text not null, page integer, embedding extensions.vector(768), search tsvector generated always as (to_tsvector('english',text)) stored,
 foreign key(source_id,owner_id) references public.sources(id,owner_id) on delete cascade,
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade
);
create index source_chunks_search on public.source_chunks using gin(search);
create index source_chunks_embedding on public.source_chunks using hnsw(embedding extensions.vector_cosine_ops);
create index source_chunks_scope on public.source_chunks(owner_id,project_id);
create table public.saved_outputs (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade, project_id uuid not null,
 title text not null, text text not null check(length(text)<=100000), updated_at timestamptz not null default now(),
 foreign key(project_id,owner_id) references public.projects(id,owner_id) on delete cascade
);
create table public.subscriptions (
 owner_id uuid primary key references auth.users on delete cascade, subscription_id text unique not null, customer_id text not null,
 status text not null, period_start timestamptz, period_end timestamptz, event_at timestamptz not null
);
create table public.generation_requests (
 id uuid primary key, owner_id uuid not null references auth.users on delete cascade, conversation_id uuid,
 status text not null check(status in ('running','complete','interrupted','error')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 input_tokens bigint not null default 0, output_tokens bigint not null default 0,
 foreign key(conversation_id,owner_id) references public.conversations(id,owner_id) on delete set null (conversation_id)
);
create index requests_usage on public.generation_requests(owner_id,created_at);
create table public.index_usage (
 owner_id uuid not null references auth.users on delete cascade,
 month date not null, characters bigint not null default 0,
 primary key(owner_id,month)
);
create table public.billing_events (id text primary key, received_at timestamptz not null default now());
create table public.feedback (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade, text text not null check(length(text) between 1 and 4000), created_at timestamptz not null default now());
create table public.product_events (id bigint generated always as identity primary key, owner_id uuid not null references auth.users on delete cascade, event text not null check(event in ('generation_completed','output_saved','signed_in')), created_at timestamptz not null default now());

-- Desktop clients may read only their own data. All writes pass through the validated API.
do $$ declare t text; begin
 foreach t in array array['projects','conversations','messages','sources','source_chunks','saved_outputs','subscriptions','generation_requests','index_usage','feedback','product_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()))',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
revoke all on public.profiles from anon,authenticated;
grant select on public.profiles to authenticated;
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit) values('workspace','workspace',false,20971520) on conflict(id) do update set public=false,file_size_limit=20971520;
create policy workspace_file_read on storage.objects for select to authenticated using(bucket_id='workspace' and (storage.foldername(name))[1]=(select auth.uid())::text);

create function public.quip_usage(p_user uuid, p_trial_limit int default 30, p_pro_limit int default 300)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sub subscriptions; prof profiles; active boolean; start_at timestamptz; end_at timestamptz; allowance int; used_count int; stored bigint; plan text;
begin
 select * into prof from profiles where id=p_user;
 select * into sub from subscriptions where owner_id=p_user;
 active := coalesce(sub.status in ('active','trialing') and sub.period_end > now(),false);
 if active then plan:='pro'; start_at:=sub.period_start; end_at:=sub.period_end; allowance:=p_pro_limit;
 else plan:=case when prof.trial_ends_at>now() then 'trial' else 'expired' end; start_at:=prof.created_at; end_at:=prof.trial_ends_at; allowance:=p_trial_limit; end if;
 select count(*) into used_count from generation_requests where owner_id=p_user and created_at>=start_at and status<>'error';
 select coalesce(sum(size),0) into stored from sources where owner_id=p_user;
 return jsonb_build_object('plan',plan,'used',used_count,'limit',allowance,'storageUsed',stored,'storageLimit',1073741824,'resetsAt',end_at,'priceLabel','US$19 / month');
end $$;

create function public.reserve_generation(p_user uuid,p_request uuid,p_conversation uuid,p_trial_limit int default 30,p_pro_limit int default 300)
returns boolean language plpgsql security definer set search_path=public as $$
declare usage jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if not exists(select 1 from conversations where id=p_conversation and owner_id=p_user) then raise exception 'Conversation unavailable'; end if;
 if exists(select 1 from generation_requests where id=p_request) then return false; end if;
 update generation_requests set status='interrupted' where owner_id=p_user and status='running' and updated_at<now()-interval '5 minutes';
 if exists(select 1 from generation_requests where owner_id=p_user and status='running') then raise exception 'Another answer is still running'; end if;
 usage:=quip_usage(p_user,p_trial_limit,p_pro_limit);
 if usage->>'plan'='expired' or (usage->>'used')::int >= (usage->>'limit')::int then raise exception 'AI allowance exhausted. Saved work remains available.'; end if;
 insert into generation_requests(id,owner_id,conversation_id,status) values(p_request,p_user,p_conversation,'running');
 return true;
end $$;

create function public.reserve_source(p_user uuid,p_source uuid,p_project uuid,p_name text,p_mime text,p_size bigint,p_kind text,p_sections jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if coalesce((select sum(size) from sources where owner_id=p_user),0)+p_size>1073741824 then raise exception 'Your storage allowance is full. Delete a source to make room.'; end if;
 insert into sources(id,owner_id,project_id,name,mime_type,size,kind,storage_path,sections) values(p_source,p_user,p_project,p_name,p_mime,p_size,p_kind,p_user::text||'/'||p_source::text,p_sections);
end $$;

create function public.search_project(p_user uuid,p_project uuid,p_query text,p_embedding extensions.vector(768),p_sources uuid[] default '{}')
returns table(source_id uuid,text text,page int,score double precision) language sql stable security definer set search_path=public,extensions as $$
 with scoped as (select c.* from source_chunks c join sources s on s.id=c.source_id where c.owner_id=p_user and c.project_id=p_project and s.status='ready' and (cardinality(p_sources)=0 or c.source_id=any(p_sources))),
 semantic as (select id,row_number() over(order by embedding <=> p_embedding) r from scoped where embedding is not null and p_embedding is not null limit 30),
 lexical as (select id,row_number() over(order by ts_rank_cd(search,websearch_to_tsquery('english',p_query)) desc) r from scoped where search @@ websearch_to_tsquery('english',p_query) limit 30)
 select s.source_id,s.text,s.page,coalesce(1.0/(60+v.r),0)+coalesce(1.0/(60+k.r),0) score from scoped s left join semantic v using(id) left join lexical k using(id) where v.id is not null or k.id is not null order by score desc limit 8;
$$;

create function public.apply_subscription_event(p_event text,p_owner uuid,p_subscription text,p_customer text,p_status text,p_start timestamptz,p_end timestamptz,p_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into billing_events(id) values(p_event) on conflict do nothing;
 if not found then return; end if;
 insert into subscriptions(owner_id,subscription_id,customer_id,status,period_start,period_end,event_at) values(p_owner,p_subscription,p_customer,p_status,p_start,p_end,p_at)
 on conflict(owner_id) do update set subscription_id=excluded.subscription_id,customer_id=excluded.customer_id,status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,event_at=excluded.event_at where subscriptions.event_at<excluded.event_at;
end $$;
-- Only service-role functions can reserve quota, change subscriptions or retrieve across scoped rows.
revoke execute on function public.quip_usage, public.reserve_generation, public.reserve_source, public.search_project, public.apply_subscription_event from public,anon,authenticated;
grant execute on function public.quip_usage, public.reserve_generation, public.reserve_source, public.search_project, public.apply_subscription_event to service_role;

create function public.append_source_chunks(p_user uuid,p_source uuid,p_offset int,p_chunks jsonb)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare source sources; item jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_source::text,0));
 select * into source from sources where id=p_source and owner_id=p_user;
 if not found then raise exception 'Source unavailable'; end if;
 if (select count(*) from source_chunks where source_id=p_source)<>p_offset then return; end if;
 for item in select * from jsonb_array_elements(p_chunks) loop
 insert into source_chunks(source_id,owner_id,project_id,text,page,embedding) values(p_source,p_user,source.project_id,item->>'text',(item->>'page')::int,(item->>'embedding')::vector(768));
 end loop;
end $$;
revoke execute on function public.append_source_chunks from public,anon,authenticated;
grant execute on function public.append_source_chunks to service_role;

-- Provider work is bounded independently of stored files. Deleting a source must
-- not reset the processing allowance; failed provider calls also consume it.
create function public.reserve_index_characters(p_user uuid,p_characters int,p_trial_limit bigint default 1000000,p_pro_limit bigint default 20000000)
returns void language plpgsql security definer set search_path = public as $$
declare plan text; allowance bigint; used bigint; month_start date := date_trunc('month',now() at time zone 'UTC')::date;
begin
 if p_characters <= 0 or p_characters > 17600 then raise exception 'Invalid indexing batch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,2));
 plan := quip_usage(p_user)->>'plan';
 allowance := case when plan='pro' then p_pro_limit when plan='trial' then p_trial_limit else 0 end;
 select characters into used from index_usage where owner_id=p_user and month=month_start;
 if coalesce(used,0)+p_characters>allowance then raise exception 'Monthly document processing allowance reached. Your saved sources remain available; retry after renewal.'; end if;
 insert into index_usage(owner_id,month,characters) values(p_user,month_start,p_characters)
 on conflict(owner_id,month) do update set characters=index_usage.characters+excluded.characters;
end $$;
revoke execute on function public.reserve_index_characters from public,anon,authenticated;
grant execute on function public.reserve_index_characters to service_role;
