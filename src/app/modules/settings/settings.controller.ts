/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { SettingsService } from './settings.services';

// GET Site Settings
const getSettingsController = async (req: Request, res: Response) => {
    try {
        const settings = await SettingsService.getSettingsService();
        res.status(200).json({
            success: true,
            message: 'Settings retrieved successfully',
            data: settings,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// UPDATE Site Settings
const updateSettingsController = async (req: Request, res: Response) => {
    try {
        const updatedSettings = await SettingsService.updateSettingsService(req.body);
        res.status(200).json({
            success: true,
            message: 'Settings updated successfully',
            data: updatedSettings,
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// UPLOAD Logo (local disk) → returns the public URL to save into settings.logo
const uploadLogoController = async (req: Request, res: Response) => {
    try {
        const file = (req as any).file;
        if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const base = `${req.protocol}://${req.get('host')}`;
        const url = file.filename ? `${base}/uploads/materials/${file.filename}` : (file.path || file.url);
        res.status(200).json({ success: true, data: { url } });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const SettingsController = {
    getSettingsController,
    updateSettingsController,
    uploadLogoController,
};
