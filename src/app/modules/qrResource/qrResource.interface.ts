import { Types } from 'mongoose';

// A single content block rendered on the public QR resource page.
// `value` holds the text body, an image URL, or a video URL/embed — which it is
// depends on `type`. This lets one resource mix text + images + videos.
export interface IQrBlock {
  type: 'text' | 'image' | 'video';
  value: string;
  caption?: string;
}

// QrResource: the public "extra resources" page that a printed-book QR code opens.
// Each question in the book gets its own QrResource, found by its unique `slug`
// (the QR image encodes <clientOrigin>/r/:slug).
export interface IQrResource {
  slug: string; // public URL key — unique + indexed
  book?: Types.ObjectId; // optional ref to the Book document
  bookTitle?: string; // free-text book name (used when there's no Book ref)
  questionNo: string; // the question number/label in the book (e.g. "12", "12a")
  questionText?: string; // the question itself (optional)
  title: string; // heading shown on the resource page
  blocks: IQrBlock[]; // mixed text/image/video content blocks
  status: 'draft' | 'published';
  views: number; // incremented on each public view

  createdAt?: Date;
  updatedAt?: Date;
}
