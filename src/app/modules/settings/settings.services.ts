import { setShopDayCutoffHour } from '../../utils/shopDay';
import { Settings } from './settings.model';
import { ISiteSettings } from './settings.interface';

// GET - Get site settings (creates default if not exists)
const getSettingsService = async (): Promise<ISiteSettings> => {
    let settings = await Settings.findOne({});

    // If no settings exist, create default settings
    if (!settings) {
        settings = await Settings.create({});
    }

    return settings;
};

// UPDATE - Update site settings
const updateSettingsService = async (
    payload: Partial<ISiteSettings>
): Promise<ISiteSettings | null> => {
    if (payload && 'shopDayCutoffHour' in payload) {
        const h = Number((payload as any).shopDayCutoffHour);
        if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('The day cutoff must be an hour from 0 to 23');
        (payload as any).shopDayCutoffHour = h;
    }
    if (payload && "ledgerDayStartHour" in payload) {
        const h = Number((payload as any).ledgerDayStartHour);
        if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error("The accounts day must start at an hour from 0 to 23");
        (payload as any).ledgerDayStartHour = h;
    }
    let settings = await Settings.findOne({});

    // If no settings exist, create with payload
    if (!settings) {
        settings = await Settings.create(payload);
        setShopDayCutoffHour((settings as any).shopDayCutoffHour);
        return settings;
    }

    // Update existing settings
    const updatedSettings = await Settings.findByIdAndUpdate(
        settings._id,
        payload,
        { new: true }
    );

    // A new day cutoff takes effect at once for every order screen.
    if (updatedSettings && payload && 'shopDayCutoffHour' in payload) {
        setShopDayCutoffHour((updatedSettings as any).shopDayCutoffHour);
    }
    return updatedSettings;
};

export const SettingsService = {
    getSettingsService,
    updateSettingsService,
};
