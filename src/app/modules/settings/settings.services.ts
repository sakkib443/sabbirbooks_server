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
    let settings = await Settings.findOne({});

    // If no settings exist, create with payload
    if (!settings) {
        settings = await Settings.create(payload);
        return settings;
    }

    // Update existing settings
    const updatedSettings = await Settings.findByIdAndUpdate(
        settings._id,
        payload,
        { new: true }
    );

    return updatedSettings;
};

export const SettingsService = {
    getSettingsService,
    updateSettingsService,
};
