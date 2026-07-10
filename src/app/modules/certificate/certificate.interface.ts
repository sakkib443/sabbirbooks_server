export interface ICertificate {
    id: string;           // Certificate ID like "BAC-CERT-001"
    studentId: string;
    studentName: string;
    batchId: string;
    courseName: string;
    batchNumber: string;
    startDate: Date;
    endDate: Date;
    issueDate: Date;
    status: 'pending' | 'active' | 'revoked';
    qrCode?: string;       // QR code data URL
    verificationUrl?: string; // Public verification link
    pdfUrl?: string;       // Generated PDF URL
    activatedBy?: string;  // Admin who activated
    activatedAt?: Date;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}
