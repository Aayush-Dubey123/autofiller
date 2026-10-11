/**
 * Single source of truth profile schema for AutoFiller AI.
 *
 * Importable by both Electron main process and renderer.
 * Defines standard fields, dropdown option sets, validators, and derived facts helpers.
 */

export type FieldInputType =
  | 'text'
  | 'date'
  | 'select'
  | 'tel'
  | 'email'
  | 'number'
  | 'year'
  | 'percentage';

export interface SchemaFieldDef {
  key: string;
  label: string;
  section: string;
  type: FieldInputType;
  options?: string[];
  placeholder?: string;
  sensitive?: boolean;
  optional?: boolean;
  subSection?: string;
}

export interface SchemaSectionDef {
  id: string;
  title: string;
  description?: string;
}

export const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed'];
export const CATEGORY_OPTIONS = ['General', 'EWS', 'OBC (NCL)', 'SC', 'ST', 'Other'];
export const RELIGION_OPTIONS = [
  'Hindu',
  'Muslim',
  'Christian',
  'Sikh',
  'Buddhist',
  'Jain',
  'Other',
];
export const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const YES_NO_OPTIONS = ['No', 'Yes'];
export const EMPLOYMENT_STATUS_OPTIONS = ['Student', 'Employed', 'Self-Employed', 'Unemployed'];

export const INDIAN_STATES_AND_UTS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

export const PROFILE_SECTIONS: SchemaSectionDef[] = [
  { id: 'personal', title: 'Personal Information', description: 'Basic identity and demographics' },
  { id: 'contact', title: 'Contact Details', description: 'Communication numbers and email' },
  { id: 'address', title: 'Address Information', description: 'Current and permanent residence' },
  { id: 'family', title: 'Family Information', description: 'Parents and guardian details' },
  { id: 'education', title: 'Education History', description: 'Academic records across all levels' },
  { id: 'current_course', title: 'Current Course', description: 'Active academic enrollment' },
  { id: 'id_numbers', title: 'ID Numbers', description: 'Government identification records' },
  { id: 'bank', title: 'Bank Details', description: 'Account and transfer information' },
  { id: 'professional', title: 'Professional Details', description: 'Employment and experience' },
  { id: 'custom', title: 'Other Details', description: 'Additional custom details' },
];

export const PROFILE_FIELDS: SchemaFieldDef[] = [
  // 1. Personal
  { key: 'first_name', label: 'First Name', section: 'personal', type: 'text', placeholder: 'e.g. Aarav', optional: false },
  { key: 'middle_name', label: 'Middle Name', section: 'personal', type: 'text', placeholder: 'e.g. Kumar', optional: true },
  { key: 'last_name', label: 'Last Name', section: 'personal', type: 'text', placeholder: 'e.g. Sharma', optional: false },
  { key: 'dob', label: 'Date of Birth', section: 'personal', type: 'date', placeholder: 'YYYY-MM-DD', optional: false },
  { key: 'gender', label: 'Gender', section: 'personal', type: 'select', options: GENDER_OPTIONS, optional: false },
  { key: 'marital_status', label: 'Marital Status', section: 'personal', type: 'select', options: MARITAL_STATUS_OPTIONS, optional: true },
  { key: 'nationality', label: 'Nationality', section: 'personal', type: 'text', placeholder: 'e.g. Indian', optional: true },
  { key: 'religion', label: 'Religion', section: 'personal', type: 'select', options: RELIGION_OPTIONS, optional: true },
  { key: 'category', label: 'Category', section: 'personal', type: 'select', options: CATEGORY_OPTIONS, optional: true },
  { key: 'blood_group', label: 'Blood Group', section: 'personal', type: 'select', options: BLOOD_GROUP_OPTIONS, optional: true },
  { key: 'mother_tongue', label: 'Mother Tongue', section: 'personal', type: 'text', placeholder: 'e.g. Hindi', optional: true },
  { key: 'disability', label: 'Person with Disability (PwD)', section: 'personal', type: 'select', options: YES_NO_OPTIONS, optional: true },

  // 2. Contact
  { key: 'phone', label: 'Primary Mobile', section: 'contact', type: 'tel', placeholder: 'e.g. 9876543210', optional: false },
  { key: 'alternate_phone', label: 'Alternate Mobile', section: 'contact', type: 'tel', placeholder: 'e.g. 9876543211', optional: true },
  { key: 'email', label: 'Email Address', section: 'contact', type: 'email', placeholder: 'e.g. student@example.com', optional: false },

  // 3. Address
  { key: 'address', label: 'Current Street Address / House No.', section: 'address', type: 'text', placeholder: 'e.g. Flat 402, Sunshine Heights, MG Road', optional: false },
  { key: 'city', label: 'Current City', section: 'address', type: 'text', placeholder: 'e.g. Mumbai', optional: false },
  { key: 'state', label: 'Current State', section: 'address', type: 'select', options: INDIAN_STATES_AND_UTS, optional: false },
  { key: 'pincode', label: 'Current Pincode', section: 'address', type: 'text', placeholder: 'e.g. 400001', optional: false },
  { key: 'permanent_address', label: 'Permanent Street Address', section: 'address', type: 'text', placeholder: 'e.g. Flat 402, Sunshine Heights, MG Road', optional: true },
  { key: 'permanent_city', label: 'Permanent City', section: 'address', type: 'text', placeholder: 'e.g. Mumbai', optional: true },
  { key: 'permanent_state', label: 'Permanent State', section: 'address', type: 'select', options: INDIAN_STATES_AND_UTS, optional: true },
  { key: 'permanent_pincode', label: 'Permanent Pincode', section: 'address', type: 'text', placeholder: 'e.g. 400001', optional: true },

  // 4. Family
  { key: 'father_name', label: "Father's Name", section: 'family', type: 'text', placeholder: 'e.g. Vikram Sharma', optional: true },
  { key: 'father_occupation', label: "Father's Occupation", section: 'family', type: 'text', placeholder: 'e.g. Business / Service', optional: true },
  { key: 'mother_name', label: "Mother's Name", section: 'family', type: 'text', placeholder: 'e.g. Sunita Sharma', optional: true },
  { key: 'mother_occupation', label: "Mother's Occupation", section: 'family', type: 'text', placeholder: 'e.g. Teacher / Homemaker', optional: true },
  { key: 'guardian_name', label: "Guardian's Name", section: 'family', type: 'text', placeholder: 'e.g. Vikram Sharma', optional: true },
  { key: 'annual_family_income', label: 'Annual Family Income (INR)', section: 'family', type: 'text', placeholder: 'e.g. 600000', optional: true },

  // 5. Education history
  { key: 'previous_school', label: 'Previous School Attended', section: 'education', type: 'text', placeholder: 'e.g. Greenwood High School', optional: true },
  // 10th
  { key: 'education_10_board', label: '10th Board', section: 'education', subSection: '10th', type: 'text', placeholder: 'e.g. CBSE / ICSE / State Board', optional: true },
  { key: 'education_10_school', label: '10th School Name', section: 'education', subSection: '10th', type: 'text', placeholder: 'e.g. Greenwood High', optional: true },
  { key: 'education_10_year', label: '10th Passing Year', section: 'education', subSection: '10th', type: 'year', placeholder: 'e.g. 2020', optional: true },
  { key: 'education_10_percentage', label: '10th Percentage / CGPA', section: 'education', subSection: '10th', type: 'percentage', placeholder: 'e.g. 88.5', optional: true },
  { key: 'education_10_roll_number', label: '10th Roll Number', section: 'education', subSection: '10th', type: 'text', placeholder: 'e.g. 1234567', optional: true },
  // 12th
  { key: 'education_12_board', label: '12th Board', section: 'education', subSection: '12th', type: 'text', placeholder: 'e.g. CBSE / State Board', optional: true },
  { key: 'education_12_school', label: '12th School / College', section: 'education', subSection: '12th', type: 'text', placeholder: 'e.g. Delhi Public School', optional: true },
  { key: 'education_12_year', label: '12th Passing Year', section: 'education', subSection: '12th', type: 'year', placeholder: 'e.g. 2022', optional: true },
  { key: 'education_12_percentage', label: '12th Percentage / CGPA', section: 'education', subSection: '12th', type: 'percentage', placeholder: 'e.g. 85.2', optional: true },
  { key: 'education_12_stream', label: '12th Stream', section: 'education', subSection: '12th', type: 'text', placeholder: 'e.g. Science / Commerce / Arts', optional: true },
  // Diploma
  { key: 'education_diploma_board', label: 'Diploma Board / Council', section: 'education', subSection: 'diploma', type: 'text', placeholder: 'e.g. State Board of Tech Education', optional: true },
  { key: 'education_diploma_college', label: 'Diploma College / Polytechnic', section: 'education', subSection: 'diploma', type: 'text', placeholder: 'e.g. Govt Polytechnic', optional: true },
  { key: 'education_diploma_year', label: 'Diploma Passing Year', section: 'education', subSection: 'diploma', type: 'year', placeholder: 'e.g. 2022', optional: true },
  { key: 'education_diploma_percentage', label: 'Diploma Percentage', section: 'education', subSection: 'diploma', type: 'percentage', placeholder: 'e.g. 78.4', optional: true },
  // Graduation
  { key: 'education_grad_degree', label: 'Graduation Degree', section: 'education', subSection: 'graduation', type: 'text', placeholder: 'e.g. B.Tech / B.Sc / B.Com', optional: true },
  { key: 'education_grad_college', label: 'Graduation College Name', section: 'education', subSection: 'graduation', type: 'text', placeholder: 'e.g. St. Stephens College', optional: true },
  { key: 'education_grad_university', label: 'Graduation University', section: 'education', subSection: 'graduation', type: 'text', placeholder: 'e.g. Delhi University', optional: true },
  { key: 'education_grad_year', label: 'Graduation Year', section: 'education', subSection: 'graduation', type: 'year', placeholder: 'e.g. 2025', optional: true },
  { key: 'education_grad_percentage', label: 'Graduation Percentage / CGPA', section: 'education', subSection: 'graduation', type: 'percentage', placeholder: 'e.g. 82.0', optional: true },
  // Post-Graduation
  { key: 'education_pg_degree', label: 'Post-Graduation Degree', section: 'education', subSection: 'post_graduation', type: 'text', placeholder: 'e.g. M.Tech / M.Sc / MBA', optional: true },
  { key: 'education_pg_college', label: 'PG College / University', section: 'education', subSection: 'post_graduation', type: 'text', placeholder: 'e.g. IIT Bombay', optional: true },
  { key: 'education_pg_year', label: 'PG Passing Year', section: 'education', subSection: 'post_graduation', type: 'year', placeholder: 'e.g. 2027', optional: true },
  { key: 'education_pg_percentage', label: 'PG Percentage / CGPA', section: 'education', subSection: 'post_graduation', type: 'percentage', placeholder: 'e.g. 80.0', optional: true },

  // 6. Current course
  { key: 'current_course_name', label: 'Current Course / Degree', section: 'current_course', type: 'text', placeholder: 'e.g. B.Tech Computer Science', optional: true },
  { key: 'current_institute_name', label: 'Current Institute / College', section: 'current_course', type: 'text', placeholder: 'e.g. National Institute of Technology', optional: true },
  { key: 'current_year_of_study', label: 'Current Year / Semester', section: 'current_course', type: 'text', placeholder: 'e.g. 2nd Year / 3rd Semester', optional: true },
  { key: 'admission_enrollment_number', label: 'Enrollment / Roll Number', section: 'current_course', type: 'text', placeholder: 'e.g. EN20240091', optional: true },
  { key: 'grade', label: 'Class / Grade Applied', section: 'current_course', type: 'text', placeholder: 'e.g. Grade 10', optional: true },

  // 7. ID numbers (sensitive: true)
  { key: 'aadhaar_card_number', label: 'Aadhaar Number', section: 'id_numbers', type: 'text', placeholder: 'e.g. 1234 5678 9012', sensitive: true, optional: true },
  { key: 'pan_card_number', label: 'PAN Card Number', section: 'id_numbers', type: 'text', placeholder: 'e.g. ABCDE1234F', sensitive: true, optional: true },
  { key: 'passport_number', label: 'Passport Number', section: 'id_numbers', type: 'text', placeholder: 'e.g. A1234567', sensitive: true, optional: true },
  { key: 'voter_id_number', label: 'Voter ID Number', section: 'id_numbers', type: 'text', placeholder: 'e.g. ABC1234567', sensitive: true, optional: true },
  { key: 'driving_license_number', label: 'Driving License', section: 'id_numbers', type: 'text', placeholder: 'e.g. DL1420110012345', sensitive: true, optional: true },

  // 8. Bank details (sensitive: true for account and IFSC)
  { key: 'bank_name', label: 'Bank Name', section: 'bank', type: 'text', placeholder: 'e.g. State Bank of India', optional: true },
  { key: 'bank_account_holder_name', label: 'Account Holder Name', section: 'bank', type: 'text', placeholder: 'e.g. Aarav Sharma', optional: true },
  { key: 'bank_account_number', label: 'Bank Account Number', section: 'bank', type: 'text', placeholder: 'e.g. 123456789012', sensitive: true, optional: true },
  { key: 'ifsc_code', label: 'IFSC Code', section: 'bank', type: 'text', placeholder: 'e.g. SBIN0001234', sensitive: true, optional: true },
  { key: 'branch_name', label: 'Branch Name', section: 'bank', type: 'text', placeholder: 'e.g. Nariman Point Branch', optional: true },

  // 9. Professional
  { key: 'employment_status', label: 'Employment Status', section: 'professional', type: 'select', options: EMPLOYMENT_STATUS_OPTIONS, optional: true },
  { key: 'employer_name', label: 'Employer / Company Name', section: 'professional', type: 'text', placeholder: 'e.g. Infosys Ltd', optional: true },
  { key: 'designation', label: 'Designation / Job Title', section: 'professional', type: 'text', placeholder: 'e.g. Software Engineer', optional: true },
  { key: 'total_experience_years', label: 'Total Experience (Years)', section: 'professional', type: 'number', placeholder: 'e.g. 2', optional: true },
];

export const EDUCATION_LEVELS = [
  { id: '10th', title: '10th / Secondary' },
  { id: '12th', title: '12th / Senior Secondary' },
  { id: 'diploma', title: 'Diploma' },
  { id: 'graduation', title: 'Graduation / Bachelor Degree' },
  { id: 'post_graduation', title: 'Post-Graduation / Master Degree' },
];

/** Index of field definitions by key. */
export const SCHEMA_FIELD_MAP = new Map<string, SchemaFieldDef>(
  PROFILE_FIELDS.map((f) => [f.key, f])
);

/**
 * Validation helpers.
 */
export function validateMobile(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: false, error: 'Mobile number is required' };
  const clean = val.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(clean)) {
    return { valid: false, error: 'Mobile number must be exactly 10 digits' };
  }
  return { valid: true };
}

export function validateOptionalMobile(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: true };
  const clean = val.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(clean)) {
    return { valid: false, error: 'Mobile number must be exactly 10 digits' };
  }
  return { valid: true };
}

export function validatePincode(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: false, error: 'Pincode is required' };
  const clean = val.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(clean)) {
    return { valid: false, error: 'Pincode must be exactly 6 digits' };
  }
  return { valid: true };
}

export function validateOptionalPincode(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: true };
  const clean = val.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(clean)) {
    return { valid: false, error: 'Pincode must be exactly 6 digits' };
  }
  return { valid: true };
}

export function validateAadhaar(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: true };
  const clean = val.replace(/[\s-]/g, '');
  if (!/^\d{12}$/.test(clean)) {
    return { valid: false, error: 'Aadhaar must be exactly 12 digits' };
  }
  return { valid: true };
}

export function validatePan(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: true };
  const clean = val.trim().toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(clean)) {
    return { valid: false, error: 'PAN must match pattern (5 letters, 4 digits, 1 letter, e.g. ABCDE1234F)' };
  }
  return { valid: true };
}

export function validateIfsc(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: true };
  const clean = val.trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(clean)) {
    return { valid: false, error: 'IFSC must be 11 characters (e.g. SBIN0001234)' };
  }
  return { valid: true };
}

export function validateEmail(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: false, error: 'Email address is required' };
  const clean = val.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { valid: false, error: 'Enter a valid email address' };
  }
  return { valid: true };
}

export function validateYear(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: true };
  const clean = val.trim();
  if (!/^\d{4}$/.test(clean)) {
    return { valid: false, error: 'Year must be a 4-digit number' };
  }
  const yearNum = parseInt(clean, 10);
  if (yearNum < 1900 || yearNum > 2100) {
    return { valid: false, error: 'Year must be between 1900 and 2100' };
  }
  return { valid: true };
}

export function validatePercentage(val: string): { valid: boolean; error?: string } {
  if (!val || !val.trim()) return { valid: true };
  const clean = val.trim();
  const num = parseFloat(clean);
  if (isNaN(num) || num < 0 || num > 100) {
    return { valid: false, error: 'Percentage must be a number between 0 and 100' };
  }
  return { valid: true };
}

/** Validate any field against its schema rules. */
export function validateFieldValue(key: string, val: string): { valid: boolean; error?: string } {
  switch (key) {
    case 'phone':
      return validateMobile(val);
    case 'alternate_phone':
      return validateOptionalMobile(val);
    case 'pincode':
      return validatePincode(val);
    case 'permanent_pincode':
      return validateOptionalPincode(val);
    case 'email':
      return validateEmail(val);
    case 'aadhaar_card_number':
      return validateAadhaar(val);
    case 'pan_card_number':
      return validatePan(val);
    case 'ifsc_code':
      return validateIfsc(val);
    default:
      if (key.endsWith('_year')) return validateYear(val);
      if (key.endsWith('_percentage')) return validatePercentage(val);
      return { valid: true };
  }
}

/**
 * Calculate age in full years from DOB string ('YYYY-MM-DD').
 */
export function calculateAge(dobStr: string): string | null {
  if (!dobStr || !dobStr.trim()) return null;
  const birth = new Date(dobStr.trim());
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 ? String(age) : null;
}

/**
 * Assemble full student name from first, middle, and last name.
 */
export function deriveFullName(firstName?: string, middleName?: string, lastName?: string): string {
  return [firstName, middleName, lastName]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Format one-line address from parts.
 */
export function deriveOneLineAddress(
  street?: string,
  city?: string,
  state?: string,
  pincode?: string
): string {
  return [street, city, state, pincode]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Pure deriveFacts function.
 * Given a map or flat object of profile facts, produces:
 * - student_name (full name from first/middle/last or fallback)
 * - age (from dob as of today)
 * - address (one-line address if parts present)
 * - one_line_address
 * - permanent_* copies when same_as_current is set.
 */
export function deriveFacts(profileFacts: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { ...profileFacts };

  // 1. student_name
  const fullName = deriveFullName(result.first_name, result.middle_name, result.last_name);
  if (fullName) {
    result.student_name = fullName;
  } else if (!result.student_name && result.first_name) {
    result.student_name = result.first_name;
  }

  // 2. age
  if (result.dob) {
    const age = calculateAge(result.dob);
    if (age !== null) {
      result.age = age;
    }
  }

  // 3. one-line address
  const oneLine = deriveOneLineAddress(result.address, result.city, result.state, result.pincode);
  if (oneLine) {
    result.one_line_address = oneLine;
    if (!result.address) {
      result.address = oneLine;
    }
  }

  // 4. permanent_* copies when same_as_current is set
  const sameAsCurrent =
    result.same_as_current_address === 'true' ||
    result.same_as_current_address === '1' ||
    result.same_as_current === 'true' ||
    result.same_as_current === '1';

  if (sameAsCurrent) {
    if (result.address && !result.permanent_address) result.permanent_address = result.address;
    if (result.city && !result.permanent_city) result.permanent_city = result.city;
    if (result.state && !result.permanent_state) result.permanent_state = result.state;
    if (result.pincode && !result.permanent_pincode) result.permanent_pincode = result.pincode;
  }

  return result;
}

/**
 * Generate a safe custom field key from its human name.
 */
export function generateCustomKey(name: string, existingKeys: Set<string>): string {
  let slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!slug) slug = 'custom_detail';

  if (SCHEMA_FIELD_MAP.has(slug) || existingKeys.has(slug)) {
    let counter = 1;
    let candidate = `${slug}_custom`;
    while (SCHEMA_FIELD_MAP.has(candidate) || existingKeys.has(candidate)) {
      counter++;
      candidate = `${slug}_custom_${counter}`;
    }
    return candidate;
  }

  return slug;
}
