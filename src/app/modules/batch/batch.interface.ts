export interface IBatch {
    id: string;           // Batch ID like "WEB-01", "PYT-02"
    name?: string;        // Batch name (optional custom name)
    courseName: string;   // Course name
    courseId?: any;        // Reference to Course
    mentorId?: any;       // Reference to Mentor
    startDate: Date;
    endDate: Date;
    classTime?: string;   // e.g. "09:00 PM - 11:00 PM"
    classDays?: string[]; // e.g. ["Saturday", "Monday", "Wednesday"]
    branch?: string;      // Branch where the batch runs (e.g. Bhairab / Narsingdi / Brahmanbaria)
    maxStudents?: number;
    status: 'active' | 'completed' | 'upcoming';
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}
