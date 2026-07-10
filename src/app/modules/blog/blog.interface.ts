export interface IBlog {
    title: string;
    titleBn?: string;
    excerpt?: string;
    excerptBn?: string;
    content: string;
    contentBn?: string;
    category: string;
    author: string;
    image: string;
    tags: string[];
    status: 'published' | 'draft';
    featured: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}
