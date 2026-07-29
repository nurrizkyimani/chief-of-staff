export type GmailReceiptAttachment = {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  receivedAt: string;
};

export type GmailReceiptSearchInput = {
  account: string;
  query: string;
  maxMessages: number;
};

export type GmailReceiptSource = {
  searchAttachments(input: GmailReceiptSearchInput): Promise<GmailReceiptAttachment[]>;
  downloadAttachment(input: {
    account: string;
    messageId: string;
    attachmentId: string;
  }): Promise<Buffer>;
};
