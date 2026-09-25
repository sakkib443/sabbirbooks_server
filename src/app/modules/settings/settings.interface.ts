/**
 * One rung of the bulk-discount ladder: "buy `minQty` copies, get this off".
 *
 * `type` decides how the cut is measured, matching the book-offer and coupon
 * vocabulary the admin already knows:
 *   percent — that share of the book total
 *   fixed   — that many taka, flat
 *
 * The cut is taken off the BOOK total (after each book's own offer, before
 * delivery) — the same base a coupon works on, so the two are comparable and
 * can never between them discount more than the books cost.
 */
export interface IQuantityDiscountTier {
    /** Copies in the order at or above which this rung applies. */
    minQty: number;
    type: 'percent' | 'fixed';
    /** Percent (0–90) or taka, per `type`. */
    value: number;
    /** Shown to the buyer on the order summary. Blank = a generated default. */
    label?: string;
}

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
    /** The shop's own district, and its reduced rate. See the model note. */
    localDeliveryDistrict: string;
    localDeliveryCharge: number;
    freeDeliveryAbove: number;
    codExtraCharge: number;
    /** When the Khulna rules were moved onto per-college rates — see the model. */
    collegeDeliveryMigratedAt?: Date;
    deliveryNote: string;
    orderSupportPhone: string;

    /**
     * Bulk discount: buy this many copies, get this much off.
     *
     * One ladder for the whole shop, matched on the TOTAL number of copies in
     * the order (a buyer taking three titles is buying in bulk just as much as
     * one taking three of the same). The best qualifying rung wins; they never
     * add up.
     */
    quantityDiscounts: IQuantityDiscountTier[];

    // Landing page (see the tier type above the interface)
    landingBookSlug: string;
    landingHeadline: string;
    landingSubheadline: string;

    createdAt?: Date;
    updatedAt?: Date;
}
