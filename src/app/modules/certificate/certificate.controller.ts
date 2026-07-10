/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { CertificateService } from './certificate.service';

const create = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.createCertificate(req.body);
        res.status(201).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getAll = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.getAllCertificates(req.query.status as string);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getPending = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.getPending();
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const activate = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const result = await CertificateService.activate(req.params.certId, user._id);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const revoke = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.revoke(req.params.certId);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const search = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.searchCertificates(req.query as any);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const verify = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.verify(req.params.certId);
        res.status(200).json({ success: true, ...result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getById = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.getCertificateById(req.params.certId);
        if (!result) return res.status(404).json({ success: false, message: 'Not found' });
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const myCertificates = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const result = await CertificateService.getStudentCertificates(user._id);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const stats = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.getStats();
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const remove = async (req: Request, res: Response) => {
    try {
        await CertificateService.deleteCertificate(req.params.certId);
        res.status(200).json({ success: true, message: 'Deleted' });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const update = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.updateCertificate(req.params.certId, req.body);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getCertBatches = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.getBatchesForCertification();
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const getBatchStudents = async (req: Request, res: Response) => {
    try {
        const result = await CertificateService.getStudentsInBatch(req.params.batchId);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const toggleEligibility = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentId, batchId, eligible } = req.body;
        const result = await CertificateService.toggleCertificateEligibility(
            studentId, batchId, eligible, user._id
        );
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

const bulkGrant = async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        const { studentIds, batchId } = req.body;
        const result = await CertificateService.bulkGrantCertificates(studentIds, batchId, user._id);
        res.status(200).json({ success: true, data: result });
    } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
};

export const CertificateController = {
    create, getAll, getPending, activate, revoke,
    search, verify, getById, myCertificates, stats,
    remove, update,
    getCertBatches, getBatchStudents, toggleEligibility, bulkGrant,
};
