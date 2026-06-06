export type OpenClawTaskResponse =
  | {
      handled: false;
    }
  | {
      handled: true;
      suppressReason: string;
      messages?: string[];
    };

export function unhandledResponse(): OpenClawTaskResponse {
  return { handled: false };
}

export function handledResponse(suppressReason: string, messages: string[] = []): OpenClawTaskResponse {
  return {
    handled: true,
    suppressReason,
    messages
  };
}
