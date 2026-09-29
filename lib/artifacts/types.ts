export type ArtifactFormat = 
  | "docx"
  | "xlsx"
  | "pptx"
  | "csv"
  | "txt"
  | "md";

export type ArtifactKind = 
  | "document"
  | "spreadsheet"
  | "presentation"
  | "text";
  
export type ArtifactRequest = {
  format: ArtifactFormat;
  kind: ArtifactKind;
  prompt: string;
  filename?: string;
};

export type GeneratedArtifact = {
  id: string;
  name: string;
  format: ArtifactFormat;
  kind: ArtifactKind;
  mimeType: string;
  base64: string;
  size: number;
};

export type ArtifactGenerationResult = {
  text: string;
  artifact: GeneratedArtifact;
};