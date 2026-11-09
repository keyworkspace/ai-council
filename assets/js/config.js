export const WORKER_URL = 'https://ai-council-inky.vercel.app/api/chat';

export const DEFAULT_MAX_ROUNDS = 3;

// Adaptadores activos. El Worker ignorará los que no tengan secreto configurado.
export const PROVIDERS = {
  groq:       { label: 'Groq (gratuito)',       requiresSecret: 'GROQ_API_KEY' },
  gemini:     { label: 'Google Gemini (free)',  requiresSecret: 'GEMINI_API_KEY' },
  openrouter: { label: 'OpenRouter (:free)',    requiresSecret: 'OPENROUTER_API_KEY' },
};
