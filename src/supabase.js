import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gajafjiphrsvztcwofhe.supabase.co'
const supabaseKey = 'sb_publishable_g7JgVrxshCRHFqv4fp2eTw_kxx-zHly'

export const supabase = createClient(supabaseUrl, supabaseKey)
