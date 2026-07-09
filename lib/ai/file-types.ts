export type AttachedFile = {
  name: string;
  type: string;
  base64: string;
};

export type FileUnderstandingResult =
  | {
      kind: "image";
      extractedText?: string;
    }
  | {
      kind: "pdf";
      extractedText?: string;
    }
  | {
      kind: "text";
      extractedText: string;
    }
  | {
      kind: "data";
      extractedText: string;
    }
  | {
      kind: "unsupported";
      error: string;
    };
