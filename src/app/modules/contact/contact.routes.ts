import express from 'express';
import { ContactController } from './contact.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// SECURITY FIX — every route below the public POST used to have NO auth at all.
// `GET /api/contacts` handed the full contact-form inbox (name, email, phone,
// message) to any unauthenticated caller, and DELETE let them wipe it. That
// defeats the whole point of a content-only manager who "must not see personal
// information": the data was public. Reads now need `users.read` and writes
// `users.write`, the same capabilities the user directory uses.
//
// Nothing in the client fetched these — the admin Feedback page renders sample
// data and the public form only POSTs — so closing them breaks no screen.
const readContacts = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager'),
  requireCapability('users.read'),
];
const writeContacts = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager'),
  requireCapability('users.write'),
];

// Create contact message (public - anyone can submit)
router.post('/create', ContactController.createContactController);

// Get all contact messages
router.get('/', ...readContacts, ContactController.getAllContactsController);

// Get unread messages count — before '/:id' so the wildcard cannot swallow it
router.get('/unread-count', ...readContacts, ContactController.getUnreadCountController);

// Get single contact message by ID
router.get('/:id', ...readContacts, ContactController.getSingleContactController);

// Update contact status by ID
router.patch('/:id', ...writeContacts, ContactController.updateContactController);

// Delete contact message by ID
router.delete('/:id', ...writeContacts, ContactController.deleteContactController);

export const ContactRoutes = router;
