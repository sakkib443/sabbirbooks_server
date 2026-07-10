export interface ISiteSettings {
    // Brand / Identity
    brandName: string;
    brandNameBn: string;
    websiteUrl: string;
    logo?: string;

    // Hero Section - English
    heroBadge: string;
    heroHeading1: string;
    heroHeading2: string;
    heroHeadingWith: string;
    heroAcademyName: string;
    heroDescription: string;

    // Hero Section - Bengali
    heroBadgeBn: string;
    heroHeading1Bn: string;
    heroHeading2Bn: string;
    heroHeadingWithBn: string;
    heroAcademyNameBn: string;
    heroDescriptionBn: string;

    // Contact Information
    phoneNumber: string;
    whatsappNumber: string;
    email: string;
    address: string;
    addressBn: string;

    // Social Links
    facebookUrl: string;
    youtubeUrl: string;
    linkedinUrl: string;

    createdAt?: Date;
    updatedAt?: Date;
}
