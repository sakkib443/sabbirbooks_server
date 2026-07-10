/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { MentorService } from './mentor.service';

// CREATE → নতুন Mentor তৈরি
export const createMentorController = async (req: Request, res: Response) => {
  try {
    const { mentor, credentials } = await MentorService.createMentorServices(req.body);
    res.status(201).json({
      success: true,
      message: 'Mentor created successfully',
      data: mentor,
      credentials, // { email, password, role, userCreated } — show to admin once
    });
  } catch (error: any) {
    const msg = error?.message || 'Error creating mentor';
    const isValidation = /already exists|required|duplicate|E11000/i.test(msg);
    res.status(isValidation ? 400 : 500).json({ success: false, message: msg });
  }
};

// READ ALL → সব Mentor (?published=true → only website-visible ones)
export const getAllMentorsController = async (req: Request, res: Response) => {
  try {
    const publicOnly = req.query.published === 'true';
    const mentors = await MentorService.getAllMentorsServices(publicOnly);
    res.status(200).json({
      success: true,
      message: 'Mentors fetched successfully',
      data: mentors,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// READ SINGLE → নির্দিষ্ট Mentor
export const getSingleMentorController = async (req: Request, res: Response) => {
  try {
    const mentor = await MentorService.getSingleMentorServices(req.params.id);
    if (!mentor) {
      return res.status(404).json({
        success: false,
        message: 'Mentor not found',
      });
    }
    res.status(200).json({
      success: true,
      message: 'Mentor fetched successfully',
      data: mentor,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// UPDATE → Mentor আপডেট
export const updateMentorController = async (req: Request, res: Response) => {
  try {
    const updatedMentor = await MentorService.updateMentorServices(
      req.params.id,
      req.body
    );
    if (!updatedMentor) {
      return res.status(404).json({
        success: false,
        message: 'Mentor not found',
      });
    }
    res.status(200).json({
      success: true,
      message: 'Mentor updated successfully',
      data: updatedMentor,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE → Mentor ডিলিট
export const deleteMentorController = async (req: Request, res: Response) => {
  try {
    const deletedMentor = await MentorService.deleteMentorServices(req.params.id);
    if (!deletedMentor) {
      return res.status(404).json({
        success: false,
        message: 'Mentor not found',
      });
    }
    res.status(200).json({
      success: true,
      message: 'Mentor deleted successfully',
      data: deletedMentor,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET MY PROFILE → Mentor নিজের প্রোফাইল (token-based)
export const getMyMentorProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { Mentor } = await import('./mentor.model');
    const mentor = await Mentor.findOne({ userId }).populate('userId', 'email role status');
    if (!mentor) return res.status(404).json({ success: false, message: 'Mentor profile not found' });
    res.status(200).json({ success: true, data: mentor });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// UPDATE MY PROFILE → Mentor নিজের প্রোফাইল আপডেট
export const updateMyMentorProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { Mentor } = await import('./mentor.model');
    const mentor = await Mentor.findOne({ userId });
    if (!mentor) return res.status(404).json({ success: false, message: 'Mentor not found' });

    // Only allow updating specific fields
    const allowed = ['name', 'phone', 'designation', 'subject', 'specialized_area',
      'education_qualification', 'work_experience', 'training_experience', 'image', 'details', 'lifeJourney'];
    const updates: any = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const updated = await Mentor.findByIdAndUpdate(mentor._id, updates, { new: true })
      .populate('userId', 'email role status');
    res.status(200).json({ success: true, message: 'Profile updated', data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const MentorController = {
  createMentorController,
  getAllMentorsController,
  getSingleMentorController,
  updateMentorController,
  deleteMentorController,
  getMyMentorProfile,
  updateMyMentorProfile,
};
