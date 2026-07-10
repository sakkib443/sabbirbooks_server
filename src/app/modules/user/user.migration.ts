import { User } from './user.model';

/**
 * Migration script to fix all duplicate user IDs
 * This will assign unique sequential IDs to all users
 */
export async function fixDuplicateUserIds(): Promise<{
    success: boolean;
    message: string;
    updatedUsers: { _id: string; oldId: string; newId: string }[];
}> {
    try {
        const year = new Date().getFullYear();

        // Get all users sorted by createdAt
        const allUsers = await User.find({ isDeleted: false })
            .sort({ createdAt: 1 })
            .lean();

        const updatedUsers: { _id: string; oldId: string; newId: string }[] = [];

        for (let i = 0; i < allUsers.length; i++) {
            const user = allUsers[i];
            const seqNum = i + 1;
            const newId = `bac-(${year})-${String(seqNum).padStart(2, '0')}`;

            // Only update if the ID is different
            if (user.id !== newId) {
                await User.findByIdAndUpdate(user._id, { id: newId });
                updatedUsers.push({
                    _id: user._id.toString(),
                    oldId: user.id || 'null',
                    newId: newId
                });
            }
        }

        return {
            success: true,
            message: `Successfully fixed ${updatedUsers.length} duplicate user IDs out of ${allUsers.length} total users`,
            updatedUsers
        };
    } catch (error: any) {
        return {
            success: false,
            message: `Error fixing user IDs: ${error.message}`,
            updatedUsers: []
        };
    }
}
