export type OpenClawTaskEvent = {
  raw: any;
  text: string;
  hasMedia: boolean;
  receivedAt: string;
};

export function mapOpenClawTaskEvent(rawEvent: any, text: string, hasMedia: boolean): OpenClawTaskEvent {
  return {
    raw: rawEvent,
    text,
    hasMedia,
    receivedAt: new Date(rawEvent?.timestamp ?? Date.now()).toISOString()
  };
}
