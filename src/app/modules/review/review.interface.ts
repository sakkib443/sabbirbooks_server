export interface IReview {
    name: string;
    role?: string;
    courseTag?: string;
    rating: number;
    text: string;
    image?: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt?: Date;
    updatedAt?: Date;
}
