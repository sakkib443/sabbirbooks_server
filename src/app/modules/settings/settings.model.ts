import { Schema, model } from 'mongoose';
import { ISiteSettings } from './settings.interface';

const settingsSchema = new Schema<ISiteSettings>(
    {
        // Brand / Identity
        //
        // These are what the Navbar, footer, browser tab title and checkout all
        // read — the brand is data, not hard-coded strings, so renaming the site
        // is a form submit rather than a redeploy.
        brandName: { type: String, default: 'Magic Viva' },
        brandNameBn: { type: String, default: 'ম্যাজিক ভাইভা' },
        // Optional second word rendered in the accent colour ("Magic *Viva*").
        // Leave blank to show brandName as one solid word.
        brandTagline: { type: String, default: 'Medical Learning Platform' },
        brandTaglineBn: { type: String, default: 'মেডিকেল শিক্ষার প্ল্যাটফর্ম' },
        websiteUrl: { type: String, default: '' },
        // Site logo — admin-uploaded URL; empty = use the built-in wordmark
        logo: { type: String, default: '' },
        // Square mark used for the browser tab icon; falls back to `logo`.
        favicon: { type: String, default: '' },

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
        phoneNumber: { type: String, default: '01799075202' },
        whatsappNumber: { type: String, default: '8801799075202' },
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

        // ── Ordering & delivery ────────────────────────────────────────────
        // Which payment methods the checkout offers. Turning both off would
        // leave nothing to click, so the order service falls back to COD.
        codEnabled: { type: Boolean, default: true },
        onlinePaymentEnabled: { type: Boolean, default: true },

        // Flat delivery charge for printed books, in taka — one rate everywhere.
        deliveryCharge: { type: Number, default: 130 },
        // Retired inside/outside-Dhaka split, kept so old documents still load.
        deliveryChargeInsideDhaka: { type: Number, default: 130 },
        deliveryChargeOutsideDhaka: { type: Number, default: 130 },
        // Free local delivery for a specific college's students shipping within
        // their own division. Empty college = rule off. See order.service.
        freeDeliveryCollege: { type: String, default: 'Khulna Medical College' },
        freeDeliveryDivision: { type: String, default: 'খুলনা' },
        // Order subtotal at or above which delivery is free. 0 = never free.
        freeDeliveryAbove: { type: Number, default: 0 },
        // Extra fee some sellers add for collecting cash. 0 = no surcharge.
        codExtraCharge: { type: Number, default: 0 },

        // Shown on the checkout page and the order confirmation.
        deliveryNote: {
            type: String,
            default: 'ঢাকার ভেতরে ১-২ দিন, ঢাকার বাইরে ২-৪ কর্মদিবসের মধ্যে বই পৌঁছে যাবে।',
        },
        // Support number printed on the order confirmation screen.
        orderSupportPhone: { type: String, default: '' },

        // ── Landing page ───────────────────────────────────────────────────
        // The public site is one page about one book. This says which book —
        // by slug, so the admin can point the landing page at a different
        // title without a deploy. Empty means "the featured book", and failing
        // that the newest published one, so the page is never blank.
        landingBookSlug: { type: String, default: '', trim: true },
        // Optional copy overriding what the book itself says, for when the
        // marketing line and the catalogue description should differ.
        landingHeadline: { type: String, default: '' },
        landingSubheadline: { type: String, default: '' },
    },
    { timestamps: true }
);

export const Settings = model<ISiteSettings>('Settings', settingsSchema);
