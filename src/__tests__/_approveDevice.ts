/**
 * Test fixture: mark a staff account's device as already approved by the
 * Super Admin, so a test about something else can sign in as admin/manager.
 * (staff-devices.e2e.ts is the test of the approval itself.)
 */
export const approveDevice = async (email: string, deviceId: string) => {
  const { User } = await import('../app/modules/user/user.model');
  const { StaffDevice } = await import('../app/modules/security/staffDevice.model');
  const u: any = await User.findOne({ email: String(email).toLowerCase() }).select('_id').lean();
  if (u) await StaffDevice.updateOne({ userId: u._id, deviceId }, { $set: { status: 'approved' } }, { upsert: true });
};
