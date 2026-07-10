export interface IContact {
    name: string;
    email: string;
    subject: string;
    message: string;
    status: 'unread' | 'read' | 'replied';
    createdAt?: Date;
    updatedAt?: Date;
}
