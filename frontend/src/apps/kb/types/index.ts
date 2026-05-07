export type KBDomain =
  | 'agentic-workflow'
  | 'tech-trends'
  | 'coding-skills'
  | 'system-design'
  | 'leadership'
  | 'startup'
  | 'agentic-ai'
  | 'vibe-coding'

export type KBConfidence = 'high' | 'medium' | 'low'

export type KBSourceType = 'web' | 'rss' | 'manual'

export interface KBEntry {
  id: string
  title: string
  domain: KBDomain
  summary: string
  tags: string[]
  confidence: KBConfidence
  source_type?: KBSourceType
  source?: string
  key_takeaways?: string[]
  context?: string
  created: string
  expires?: string | null
}

export interface KBStats {
  total_entries: number
  by_domain: Record<KBDomain, number>
}

export interface KBSource {
  type: string
  url: string
  limit?: number
}

export type KBSourcesByDomain = Record<string, KBSource[]>

export interface IngestRequest {
  url: string
  domain: KBDomain
}

export interface IngestResult {
  ok: boolean
  message: string
  entry_id?: string
  title?: string
}
