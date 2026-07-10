/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { ContactService } from './contact.services';

// CREATE Contact Message
const createContactController = async (req: Request, res: Response) => {
    try {
        const contact = await ContactService.createContactService(req.body);
        res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: contact,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET All Contact Messages
const getAllContactsController = async (req: Request, res: Response) => {
    try {
        const contacts = await ContactService.getAllContactsService();
        res.status(200).json({ success: true, data: contacts });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET Single Contact Message
const getSingleContactController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const contact = await ContactService.getSingleContactService(id);
        if (!contact) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }
        res.status(200).json({ success: true, data: contact });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// UPDATE Contact Status (mark as read/replied)
const updateContactController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const updatedContact = await ContactService.updateContactService(id, req.body);
        if (!updatedContact) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Message updated successfully',
            data: updatedContact,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE Contact Message
const deleteContactController = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const deletedContact = await ContactService.deleteContactService(id);
        if (!deletedContact) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Message deleted successfully',
            data: deletedContact,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET Unread Messages Count
const getUnreadCountController = async (req: Request, res: Response) => {
    try {
        const count = await ContactService.getUnreadCountService();
        res.status(200).json({ success: true, data: { count } });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const ContactController = {
    createContactController,
    getAllContactsController,
    getSingleContactController,
    updateContactController,
    deleteContactController,
    getUnreadCountController,
};
