import express from 'express';
import { ContactController } from './contact.controller';

const router = express.Router();

// Create contact message (public - anyone can submit)
router.post('/create', ContactController.createContactController);

// Get all contact messages (admin only)
router.get('/', ContactController.getAllContactsController);

// Get unread messages count (admin only)
router.get('/unread-count', ContactController.getUnreadCountController);

// Get single contact message by ID (admin only)
router.get('/:id', ContactController.getSingleContactController);

// Update contact status by ID (admin only)
router.patch('/:id', ContactController.updateContactController);

// Delete contact message by ID (admin only)
router.delete('/:id', ContactController.deleteContactController);

export const ContactRoutes = router;
