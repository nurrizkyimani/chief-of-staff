export type VisionModelInput = {
  imageBase64: string;
  mimeType: string;
  prompt: string;
};

export type VisionModelPort<TOutput> = {
  parseImage(input: VisionModelInput): Promise<TOutput>;
};
