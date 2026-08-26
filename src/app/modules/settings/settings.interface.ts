export interface ISiteSettings {
    // Brand / Identity
    brandName: string;
    brandNameBn: string;
    brandTagline?: string;
    brandTaglineBn?: string;
    websiteUrl: string;
    logo?: string;
    favicon?: string;

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

    // Manual payment — receiving mobile-wallet numbers shown on checkout.
    // Empty string = that wallet is hidden on the checkout page.
    paymentBkashNumber: string;
    paymentRocketNumber: string;
    paymentNagadNumber: string;
    // Optional extra instruction line shown under the numbers (e.g. "Send Money, not Payment").
    paymentInstructions: string;

    // Ordering & delivery (printed books)
    codEnabled: boolean;
    onlinePaymentEnabled: boolean;
    // Flat delivery charge, one rate everywhere (taka). The old inside/outside
    // Dhaka split is retired; these two are kept only so old documents type.
    deliveryCharge: number;
    deliveryChargeInsideDhaka: number;
    deliveryChargeOutsideDhaka: number;
    // Free local delivery: a student of `freeDeliveryCollege` shipping within
    // `freeDeliveryDivision` pays nothing; the same student shipping to any other
    // division pays the flat charge. Empty college turns the rule off.
    freeDeliveryCollege: string;
    freeDeliveryDivision: string;
    freeDeliveryAbove: number;
    codExtraCharge: number;
    deliveryNote: string;
    orderSupportPhone: string;

    // Landing page
    landingBookSlug: string;
    landingHeadline: string;
    landingSubheadline: string;

    createdAt?: Date;
    updatedAt?: Date;
}
