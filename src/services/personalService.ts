import { staffService, StaffMember, StaffStatus } from './staffService';

export type PersonalStatus = StaffStatus;
export type PersonalMember = StaffMember;

export const personalService = {
  addPersonalMember: staffService.addStaffMember,
  updatePersonalMember: staffService.updateStaffMember,
  deletePersonalMember: staffService.deleteStaffMember,
  getPersonalMember: staffService.getStaffMember,
  subscribeToPersonal: staffService.subscribeToStaff,
};
