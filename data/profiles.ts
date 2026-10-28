// The distributable template intentionally contains no people or profile records.
// Create profiles from the administrator dashboard after connecting Supabase.
export type ProfileExample = {
  id: string;
  name: string;
  image: string;
  gallery: string[];
  intro: string;
  style?: string;
  interest?: string;
};

export const profileExamples: ProfileExample[] = [];
