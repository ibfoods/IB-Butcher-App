export default function handler(req, res) {
  res.status(200).json({
    hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrlPreview: process.env.SUPABASE_URL?.slice(0, 30) || "MISSING",
    nodeEnv: process.env.NODE_ENV,
  });
}
