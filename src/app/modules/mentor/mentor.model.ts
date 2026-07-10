import { Schema, model } from 'mongoose';

const mentorSchema = new Schema({
  id: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  email: { type: String },
  phone: { type: String },
  designation: { type: String, required: true },
  subject: { type: String, required: true },
  specialized_area: { type: [String], required: true },
  education_qualification: { type: [String], required: true },
  work_experience: { type: [String], required: true },
  training_experience: { years: { type: String, required: true }, students: { type: String, required: true } },
  image: { type: String, required: true },
  details: { type: String, required: true },
  lifeJourney: { type: String, required: true },
  // Controls whether this mentor shows on the public website (mentors listing).
  // Default true so existing mentors stay visible; admin can hide specific ones.
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

export const Mentor = model('Mentor', mentorSchema);
