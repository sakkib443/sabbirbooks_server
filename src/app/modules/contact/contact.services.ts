import { Contact } from './contact.model';
import { IContact } from './contact.interface';

// CREATE - Create new contact message
const createContactService = async (payload: IContact): Promise<IContact> => {
    const newContact = await Contact.create(payload);
    return newContact;
};

// READ - Get all contact messages
const getAllContactsService = async (): Promise<IContact[]> => {
    const contacts = await Contact.find({}).sort({ createdAt: -1 });
    return contacts;
};

// READ - Get single contact by ID
const getSingleContactService = async (id: string): Promise<IContact | null> => {
    const contact = await Contact.findById(id);
    return contact;
};

// UPDATE - Update contact status by ID
const updateContactService = async (
    id: string,
    payload: Partial<IContact>
): Promise<IContact | null> => {
    const updatedContact = await Contact.findByIdAndUpdate(id, payload, { new: true });
    return updatedContact;
};

// DELETE - Delete contact by ID
const deleteContactService = async (id: string): Promise<IContact | null> => {
    const deletedContact = await Contact.findByIdAndDelete(id);
    return deletedContact;
};

// Get unread contacts count
const getUnreadCountService = async (): Promise<number> => {
    const count = await Contact.countDocuments({ status: 'unread' });
    return count;
};

export const ContactService = {
    createContactService,
    getAllContactsService,
    getSingleContactService,
    updateContactService,
    deleteContactService,
    getUnreadCountService,
};
