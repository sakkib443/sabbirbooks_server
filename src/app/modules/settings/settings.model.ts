import { Schema, model } from 'mongoose';
import { ISiteSettings } from './settings.interface';

const settingsSchema = new Schema<ISiteSettings>(
    {
        // Brand / Identity
        brandName: { type: String, default: 'Aptech Learning' },
        brandNameBn: { type: String, default: 'অ্যাপটেক লার্নিং' },
        websiteUrl: { type: String, default: 'https://aptechlearning.com' },
        // Site logo — admin-uploaded URL; empty = use the built-in default logo
        logo: { type: String, default: '' },

        // Hero Section - English
        heroBadge: { type: String, default: '🎓 A Leading Platform for Skills Development' },
        heroHeading1: { type: String, default: 'Transform Your' },
        heroHeading2: { type: String, default: 'Career Path' },
        heroHeadingWith: { type: String, default: 'with' },
        heroAcademyName: { type: String, default: 'Aptech Learning' },
        heroDescription: { type: String, default: 'Welcome to Aptech Learning — empowering your career with industry-focused IELTS, Spoken English, Office Management, Graphic Design, Web Design, AutoCAD, and Digital Marketing courses taught by expert mentors.' },

        // Hero Section - Bengali
        heroBadgeBn: { type: String, default: '🎓 দক্ষতা উন্নয়নের একটি অগ্রণী প্ল্যাটফর্ম' },
        heroHeading1Bn: { type: String, default: 'আপনার ক্যারিয়ার' },
        heroHeading2Bn: { type: String, default: 'রূপান্তর করুন' },
        heroHeadingWithBn: { type: String, default: 'সাথে' },
        heroAcademyNameBn: { type: String, default: 'অ্যাপটেক লার্নিং' },
        heroDescriptionBn: { type: String, default: 'অ্যাপটেক লার্নিং-এ স্বাগতম — IELTS, স্পোকেন ইংলিশ, অফিস ম্যানেজমেন্ট, গ্রাফিক ডিজাইন, ওয়েব ডিজাইন, অটোক্যাড এবং ডিজিটাল মার্কেটিং কোর্সের মাধ্যমে অভিজ্ঞ মেন্টরদের কাছ থেকে শিখে আপনার ক্যারিয়ার গড়ে তুলুন।' },

        // Contact Information
        phoneNumber: { type: String, default: '+880 1711-946614' },
        whatsappNumber: { type: String, default: '8801711946614' },
        email: { type: String, default: 'info@aptechlearning.com' },
        address: { type: String, default: 'House 25, Road - 11, DIT Project, Marul Badda, Badda, Dhaka, Bangladesh' },
        addressBn: { type: String, default: 'বাড়ি ২৫, রোড - ১১, ডিআইটি প্রজেক্ট, মেরুল বাড্ডা, বাড্ডা, ঢাকা' },

        // Social Links
        facebookUrl: { type: String, default: 'https://www.facebook.com/aptechlearning' },
        youtubeUrl: { type: String, default: 'https://aptechlearning.com' },
        linkedinUrl: { type: String, default: 'https://aptechlearning.com' },

        // Manual payment — receiving mobile-wallet numbers (empty = hidden on checkout)
        paymentBkashNumber: { type: String, default: '' },
        paymentRocketNumber: { type: String, default: '' },
        paymentNagadNumber: { type: String, default: '' },
        paymentInstructions: { type: String, default: '' },
    },
    { timestamps: true }
);

export const Settings = model<ISiteSettings>('Settings', settingsSchema);
