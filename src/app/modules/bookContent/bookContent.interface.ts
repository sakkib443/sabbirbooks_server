import { Types } from 'mongoose';

// Printed-book content tree:
//   Book → BookPart → BookChapter → BookTopic → BookQuestion
//
// The QR code printed in the book sits on the TOPIC. Scanning it opens that
// topic's questions and nothing else — the scoping is enforced server-side in
// bookContent.service, not hidden in the UI.

export interface IBookPart {
  bookId: Types.ObjectId;
  title: string;
  titleBn?: string;
  order: number;
  isPublished: boolean;
  isDeleted: boolean;
}

export interface IBookChapter {
  bookId: Types.ObjectId;
  partId: Types.ObjectId;
  // "1", "2.3" — free text, never parsed as a number.
  chapterNo?: string;
  title: string;
  titleBn?: string;
  order: number;
  // A free chapter's topics are readable by any signed-in user without owning
  // the book. Used for a sample chapter so buyers can try before purchasing.
  isFree: boolean;
  isPublished: boolean;
  isDeleted: boolean;
}

export interface IBookTopic {
  bookId: Types.ObjectId;
  partId: Types.ObjectId;
  chapterId: Types.ObjectId;
  topicNo?: string;
  title: string;
  titleBn?: string;

  // Printed next to the topic in the book. Random, not sequential, so the set
  // of valid codes cannot be walked by guessing.
  qrCode: string;

  // Some chapters ("Cell Biology and Genetics") hold questions directly with no
  // sub-topics. A QR still has to live somewhere, so the import creates a single
  // topic named after the chapter and flags it — the viewer then skips repeating
  // the title.
  isImplicit: boolean;

  scanCount: number;
  order: number;
  isPublished: boolean;
  isDeleted: boolean;
}

export interface IQuestionVideo {
  title?: string;
  url: string;
  // 'upload' means the file lives on our own disk under /uploads and must be
  // played with a <video> tag; the rest are embedded in an iframe.
  provider: 'youtube' | 'vimeo' | 'cloudinary' | 'upload' | 'other';
  durationSec?: number;
  // Set for uploaded files so the reader can be offered a download.
  fileName?: string;
  fileSize?: number;
}

export interface IQuestionAttachment {
  title: string;
  fileUrl: string;
  fileType: string;
  fileSize?: number;
}

export interface IBookQuestion {
  bookId: Types.ObjectId;
  chapterId: Types.ObjectId;
  topicId: Types.ObjectId;

  // "1", "2(ক)" — free text, so never a number.
  questionNo: string;
  questionText?: string;
  questionTextBn?: string;

  // Optional on purpose: the import lays down 381 placeholder questions and the
  // admin fills the answers in over time.
  answerHtml?: string;

  videos: IQuestionVideo[];
  attachments: IQuestionAttachment[];
  images: string[];

  order: number;
  isPublished: boolean;
  isDeleted: boolean;
}
