import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite({ extensions: { vector } });
  // Model Supabase-owned schemas; application SQL below is the actual production migration.
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;create schema extensions;
    create table auth.users(id uuid primary key,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key,bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;
    grant select on storage.objects to authenticated;`);
  await pg.exec(
    await fs.readFile("supabase/migrations/202609080001_workspace.sql", "utf8"),
  );
}, 60000);
afterAll(async () => {
  await pg?.close();
});
async function fixture() {
  const owner = randomUUID(),
    project = randomUUID(),
    conversation = randomUUID();
  await pg.query("insert into auth.users(id) values($1)", [owner]);
  await pg.query(
    "insert into projects(id,owner_id,name) values($1,$2,'Private project')",
    [project, owner],
  );
  await pg.query(
    "insert into conversations(id,owner_id,project_id,title) values($1,$2,$3,'Private chat')",
    [conversation, owner, project],
  );
  return { owner, project, conversation };
}
async function asUser<T>(owner: string, work: () => Promise<T>) {
  await pg.exec("set role authenticated");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  try {
    return await work();
  } finally {
    await pg.exec("reset role");
  }
}

describe("production database isolation and limits", () => {
  it("hides another account's private file objects", async () => {
    const a = await fixture(),
      b = await fixture();
    for (const user of [a, b])
      await pg.query(
        "insert into storage.objects(id,bucket_id,name) values($1,'workspace',$2)",
        [randomUUID(), `${user.owner}/${randomUUID()}`],
      );
    await asUser(a.owner, async () => {
      const result = await pg.query<{ name: string }>(
        "select name from storage.objects",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name.startsWith(`${a.owner}/`)).toBe(true);
    });
  });
  it("does not duplicate source chunks when an indexing batch is retried", async () => {
    const a = await fixture(),
      source = randomUUID();
    await pg.query(
      "select reserve_source($1,$2,$3,'Brief','text/plain',10,'document','[]')",
      [a.owner, source, a.project],
    );
    const batch = JSON.stringify([{ text: "The launch is Friday.", page: 3 }]);
    await pg.query("select append_source_chunks($1,$2,0,$3)", [
      a.owner,
      source,
      batch,
    ]);
    await pg.query("select append_source_chunks($1,$2,0,$3)", [
      a.owner,
      source,
      batch,
    ]);
    const chunks = await pg.query<{ text: string; page: number }>(
      "select text,page from source_chunks where source_id=$1",
      [source],
    );
    expect(chunks.rows).toEqual([{ text: "The launch is Friday.", page: 3 }]);
  });
  it("cannot reset AI usage by deleting a conversation", async () => {
    const a = await fixture();
    await pg.query(
      "insert into generation_requests(id,owner_id,conversation_id,status) values($1,$2,$3,'complete')",
      [randomUUID(), a.owner, a.conversation],
    );
    await pg.query("delete from conversations where id=$1", [a.conversation]);
    const usage = await pg.query<{ usage: { used: number } }>(
      "select quip_usage($1) usage",
      [a.owner],
    );
    expect(usage.rows[0].usage.used).toBe(1);
    expect(
      (
        await pg.query<{ conversation_id: string | null }>(
          "select conversation_id from generation_requests where owner_id=$1",
          [a.owner],
        )
      ).rows[0].conversation_id,
    ).toBeNull();
  });
  it("bounds document processing even after the original project is deleted", async () => {
    const a = await fixture();
    await pg.query("select reserve_index_characters($1,100,100,100)", [
      a.owner,
    ]);
    await pg.query("delete from projects where id=$1", [a.project]);
    await expect(
      pg.query("select reserve_index_characters($1,1,100,100)", [a.owner]),
    ).rejects.toThrow(/processing allowance/);
    await asUser(a.owner, async () => {
      await expect(
        pg.query("select reserve_index_characters($1,1)", [a.owner]),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("shows an authenticated user only their own projects and denies direct writes", async () => {
    const a = await fixture(),
      b = await fixture();
    await asUser(a.owner, async () => {
      const rows = await pg.query<{ id: string }>("select id from projects");
      expect(rows.rows.map((row) => row.id)).toEqual([a.project]);
      await expect(
        pg.query("update projects set name='Stolen' where id=$1", [b.project]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        pg.query("select reserve_generation($1,$2,$3)", [
          a.owner,
          randomUUID(),
          a.conversation,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });
  it("rejects a conversation pointing into another account's project", async () => {
    const a = await fixture(),
      b = await fixture();
    await expect(
      pg.query(
        "insert into conversations(id,owner_id,project_id,title) values($1,$2,$3,'Bad')",
        [randomUUID(), a.owner, b.project],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("reserves a request exactly once and refuses overlapping requests", async () => {
    const a = await fixture(),
      request = randomUUID();
    const result = await pg.query<{ reserved: boolean }>(
      "select reserve_generation($1,$2,$3) reserved",
      [a.owner, request, a.conversation],
    );
    expect(result.rows[0].reserved).toBe(true);
    expect(
      (
        await pg.query<{ reserved: boolean }>(
          "select reserve_generation($1,$2,$3) reserved",
          [a.owner, request, a.conversation],
        )
      ).rows[0].reserved,
    ).toBe(false);
    await expect(
      pg.query("select reserve_generation($1,$2,$3)", [
        a.owner,
        randomUUID(),
        a.conversation,
      ]),
    ).rejects.toThrow(/still running/);
  });
  it("enforces trial allowance without restricting access to saved work", async () => {
    const a = await fixture();
    await pg.query(
      "insert into generation_requests(id,owner_id,conversation_id,status) values($1,$2,$3,'complete')",
      [randomUUID(), a.owner, a.conversation],
    );
    await expect(
      pg.query("select reserve_generation($1,$2,$3,1,300)", [
        a.owner,
        randomUUID(),
        a.conversation,
      ]),
    ).rejects.toThrow(/allowance exhausted/);
    await asUser(a.owner, async () =>
      expect((await pg.query("select * from conversations")).rows).toHaveLength(
        1,
      ),
    );
  });
  it("ignores duplicate and older billing events", async () => {
    const a = await fixture();
    const event = randomUUID(),
      date = new Date().toISOString(),
      end = new Date(Date.now() + 86400000).toISOString();
    const args = [
      event,
      a.owner,
      `sub_${a.owner}`,
      `ctm_${a.owner}`,
      "active",
      date,
      end,
      date,
    ];
    await pg.query(
      "select apply_subscription_event($1,$2,$3,$4,$5,$6,$7,$8)",
      args,
    );
    await pg.query("select apply_subscription_event($1,$2,$3,$4,$5,$6,$7,$8)", [
      randomUUID(),
      a.owner,
      args[2],
      args[3],
      "canceled",
      date,
      end,
      "2020-01-01T00:00:00Z",
    ]);
    await pg.query(
      "select apply_subscription_event($1,$2,$3,$4,$5,$6,$7,$8)",
      args,
    );
    const sub = await pg.query<{ status: string }>(
      "select status from subscriptions where owner_id=$1",
      [a.owner],
    );
    expect(sub.rows[0].status).toBe("active");
  });
  it("enforces storage allowance and removes indexed content with its project", async () => {
    const a = await fixture();
    for (let i = 0; i < 51; i++)
      await pg.query(
        "select reserve_source($1,$2,$3,'Brief','text/plain',20971520,'document','[]')",
        [a.owner, randomUUID(), a.project],
      );
    await expect(
      pg.query(
        "select reserve_source($1,$2,$3,'Brief','text/plain',20971520,'document','[]')",
        [a.owner, randomUUID(), a.project],
      ),
    ).rejects.toThrow(/storage allowance/);
    await pg.query("delete from projects where id=$1", [a.project]);
    expect(
      (await pg.query("select id from sources where owner_id=$1", [a.owner]))
        .rows,
    ).toHaveLength(0);
  });
  it("retrieves evidence only from the requested account and project", async () => {
    const a = await fixture(),
      b = await fixture();
    for (const account of [a, b]) {
      const source = randomUUID();
      await pg.query(
        "select reserve_source($1,$2,$3,'Brief','text/plain',10,'document','[]')",
        [account.owner, source, account.project],
      );
      await pg.query("update sources set status='ready' where id=$1", [source]);
      await pg.query(
        "insert into source_chunks(source_id,owner_id,project_id,text,page) values($1,$2,$3,'Launch deadline is Friday',2)",
        [source, account.owner, account.project],
      );
    }
    const result = await pg.query<{
      source_id: string;
      text: string;
      page: number;
    }>("select * from search_project($1,$2,'deadline',null)", [
      a.owner,
      a.project,
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].page).toBe(2);
    expect(
      (
        await pg.query("select * from search_project($1,$2,'deadline',null)", [
          a.owner,
          b.project,
        ])
      ).rows,
    ).toHaveLength(0);
  });
});
