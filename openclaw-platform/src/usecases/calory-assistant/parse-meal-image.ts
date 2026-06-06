export type ParseMealImageInput = {
  imageBase64: string;
  mimeType: string;
};

export type ParseMealImageResult = {
  calories: number;
  confidence: number;
};
