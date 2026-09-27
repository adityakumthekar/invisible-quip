const required=['QUIP_SUPABASE_URL','QUIP_SUPABASE_ANON_KEY','CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID']
const missing=required.filter(key=>!process.env[key]||/YOUR_PROJECT|YOUR_PUBLISHABLE/.test(process.env[key]))
if(missing.length){console.error(`Release configuration is incomplete: ${missing.join(', ')}`);process.exit(1)}
if(new URL(process.env.QUIP_SUPABASE_URL).protocol!=='https:')throw new Error('Production cloud configuration must use HTTPS.')
console.log('Cloud and signing configuration present. No credential values were printed.')
