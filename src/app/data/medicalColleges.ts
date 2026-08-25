// Bangladesh medical colleges — seed data.
//
// Extracted from the client-supplied PDF (Bangladesh_Medical_Colleges_Detailed_List),
// which lists 112 institutions for the 2025-26 session: 37 government, 68 private
// (66 active) and 7 military. Division and district came out of the PDF with their
// Bengali vowel signs reordered, so each was matched back to the canonical spelling.
//
// This seeds the database once; after that the admin panel is the source of truth,
// so corrections do not need a deploy. Re-running the seed never duplicates and
// never overwrites an edited row.
//
// The upazila/area column is deliberately blank. Unlike division and district,
// which were repaired against canonical lists, there is no authoritative list of
// the 495 upazilas to match the mangled cells against — and showing a student
// "চোাদপুর সিদর" is worse than showing nothing. District is what the delivery
// charge and the address prefill actually use. Admins can fill areas in later.
//
// One row carries needsReview: the PDF cell holding its name did not survive text
// extraction. Its other fields are intact. It is left blank rather than guessed.

export interface SeedCollege {
  name: string;
  type: 'government' | 'private' | 'army';
  division: string;
  district: string;
  area: string;
  established: number;
  seats: number | null;
  needsReview?: boolean;
}

export const MEDICAL_COLLEGES: SeedCollege[] = [
  {
    "name": "Dhaka Medical College",
    "type": "government",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1946,
    "seats": 225
  },
  {
    "name": "Sir Salimullah Medical College",
    "type": "government",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1972,
    "seats": 225
  },
  {
    "name": "Shaheed Suhrawardy Medical College",
    "type": "government",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2006,
    "seats": 225
  },
  {
    "name": "Chittagong Medical College",
    "type": "government",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 1957,
    "seats": 225
  },
  {
    "name": "Rajshahi Medical College",
    "type": "government",
    "division": "রাজশাহী",
    "district": "রাজশাহী",
    "area": "",
    "established": 1958,
    "seats": 225
  },
  {
    "name": "Mymensingh Medical College",
    "type": "government",
    "division": "ময়মনসিংহ",
    "district": "ময়মনসিংহ",
    "area": "",
    "established": 1962,
    "seats": 225
  },
  {
    "name": "Sylhet MAG Osmani Medical College",
    "type": "government",
    "division": "সিলেট",
    "district": "সিলেট",
    "area": "",
    "established": 1962,
    "seats": 225
  },
  {
    "name": "Sher-e-Bangla Medical College",
    "type": "government",
    "division": "বরিশাল",
    "district": "বরিশাল",
    "area": "",
    "established": 1968,
    "seats": 225
  },
  {
    "name": "Rangpur Medical College",
    "type": "government",
    "division": "রংপুর",
    "district": "রংপুর",
    "area": "",
    "established": 1970,
    "seats": 225
  },
  {
    "name": "Cumilla Medical College",
    "type": "government",
    "division": "চট্টগ্রাম",
    "district": "কুমিল্লা",
    "area": "",
    "established": 1992,
    "seats": 200
  },
  {
    "name": "Dinajpur Medical College (M. Abdur Rahim MC)",
    "type": "government",
    "division": "রংপুর",
    "district": "দিনাজপুর",
    "area": "",
    "established": 1992,
    "seats": 200
  },
  {
    "name": "Faridpur Medical College (Bangabandhu MC)",
    "type": "government",
    "division": "ঢাকা",
    "district": "ফরিদপুর",
    "area": "",
    "established": 1992,
    "seats": 200
  },
  {
    "name": "Khulna Medical College",
    "type": "government",
    "division": "খুলনা",
    "district": "খুলনা",
    "area": "",
    "established": 1992,
    "seats": 200
  },
  {
    "name": "Shaheed Ziaur Rahman Medical College",
    "type": "government",
    "division": "রাজশাহী",
    "district": "বগুড়া",
    "area": "",
    "established": 1992,
    "seats": 200
  },
  {
    "name": "Cox's Bazar Medical College",
    "type": "government",
    "division": "চট্টগ্রাম",
    "district": "কক্সবাজার",
    "area": "",
    "established": 2008,
    "seats": 100
  },
  {
    "name": "Noakhali Medical College (Abdul Malek Ukil MC)",
    "type": "government",
    "division": "চট্টগ্রাম",
    "district": "নোয়াখালী",
    "area": "",
    "established": 2008,
    "seats": 100
  },
  {
    "name": "Pabna Medical College",
    "type": "government",
    "division": "রাজশাহী",
    "district": "পাবনা",
    "area": "",
    "established": 2008,
    "seats": 100
  },
  {
    "name": "Jashore Medical College",
    "type": "government",
    "division": "খুলনা",
    "district": "যশোর",
    "area": "",
    "established": 2010,
    "seats": 100
  },
  {
    "name": "Gopalganj Medical College (Sheikh Sayera Khatun MC)",
    "type": "government",
    "division": "ঢাকা",
    "district": "গোপালগঞ্জ",
    "area": "",
    "established": 2011,
    "seats": 125
  },
  {
    "name": "Kushtia Medical College",
    "type": "government",
    "division": "খুলনা",
    "district": "কুষ্টিয়া",
    "area": "",
    "established": 2011,
    "seats": 100
  },
  {
    "name": "Satkhira Medical College",
    "type": "government",
    "division": "খুলনা",
    "district": "সাতক্ষীরা",
    "area": "",
    "established": 2011,
    "seats": 100
  },
  {
    "name": "Shahid Syed Nazrul Islam Medical College",
    "type": "government",
    "division": "ঢাকা",
    "district": "কিশোরগঞ্জ",
    "area": "",
    "established": 2011,
    "seats": 100
  },
  {
    "name": "Shaheed Tajuddin Ahmad Medical College",
    "type": "government",
    "division": "ঢাকা",
    "district": "গাজীপুর",
    "area": "",
    "established": 2013,
    "seats": 125
  },
  {
    "name": "",
    "type": "government",
    "division": "ময়মনসিংহ",
    "district": "জামালপুর",
    "area": "",
    "established": 2014,
    "seats": 100,
    "needsReview": true
  },
  {
    "name": "Manikganj Medical College (Colonel Malek MC)",
    "type": "government",
    "division": "ঢাকা",
    "district": "মানিকগঞ্জ",
    "area": "",
    "established": 2014,
    "seats": 125
  },
  {
    "name": "Patuakhali Medical College",
    "type": "government",
    "division": "বরিশাল",
    "district": "পটুয়াখালী",
    "area": "",
    "established": 2014,
    "seats": 100
  },
  {
    "name": "Rangamati Medical College",
    "type": "government",
    "division": "চট্টগ্রাম",
    "district": "রাঙ্গামাটি",
    "area": "",
    "established": 2014,
    "seats": 75
  },
  {
    "name": "Sirajganj Medical College (Shaheed M Mansur Ali MC)",
    "type": "government",
    "division": "রাজশাহী",
    "district": "সিরাজগঞ্জ",
    "area": "",
    "established": 2014,
    "seats": 100
  },
  {
    "name": "Tangail Medical College (Sheikh Hasina MC)",
    "type": "government",
    "division": "ঢাকা",
    "district": "টাঙ্গাইল",
    "area": "",
    "established": 2014,
    "seats": 125
  },
  {
    "name": "Mugda Medical College",
    "type": "government",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2016,
    "seats": 100
  },
  {
    "name": "Habiganj Medical College (Sheikh Hasina MC)",
    "type": "government",
    "division": "সিলেট",
    "district": "হবিগঞ্জ",
    "area": "",
    "established": 2018,
    "seats": 50
  },
  {
    "name": "Chandpur Medical College",
    "type": "government",
    "division": "চট্টগ্রাম",
    "district": "চাঁদপুর",
    "area": "",
    "established": 2018,
    "seats": 50
  },
  {
    "name": "Magura Medical College",
    "type": "government",
    "division": "খুলনা",
    "district": "মাগুরা",
    "area": "",
    "established": 2018,
    "seats": 50
  },
  {
    "name": "Naogaon Medical College",
    "type": "government",
    "division": "রাজশাহী",
    "district": "নওগাঁ",
    "area": "",
    "established": 2018,
    "seats": 50
  },
  {
    "name": "Netrokona Medical College",
    "type": "government",
    "division": "ময়মনসিংহ",
    "district": "নেত্রকোণা",
    "area": "",
    "established": 2018,
    "seats": 50
  },
  {
    "name": "Nilphamari Medical College",
    "type": "government",
    "division": "রংপুর",
    "district": "নীলফামারী",
    "area": "",
    "established": 2018,
    "seats": 75
  },
  {
    "name": "Sunamganj Medical College (Bangabandhu MC)",
    "type": "government",
    "division": "সিলেট",
    "district": "সুনামগঞ্জ",
    "area": "",
    "established": 2021,
    "seats": 75
  },
  {
    "name": "Bangladesh Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1986,
    "seats": 120
  },
  {
    "name": "Institute of Applied Health Sciences",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 1989,
    "seats": 75
  },
  {
    "name": "Jahurul Islam Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "কিশোরগঞ্জ",
    "area": "",
    "established": 1992,
    "seats": 100
  },
  {
    "name": "Medical College for Women & Hospital",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1992,
    "seats": 90
  },
  {
    "name": "Z. H. Sikder Women's Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1992,
    "seats": 100
  },
  {
    "name": "Shaheed Monsur Ali Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1994,
    "seats": 140
  },
  {
    "name": "Dhaka National Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1994,
    "seats": 130
  },
  {
    "name": "Community Based Medical College",
    "type": "private",
    "division": "ময়মনসিংহ",
    "district": "ময়মনসিংহ",
    "area": "",
    "established": 1995,
    "seats": 130
  },
  {
    "name": "Jalalabad Ragib-Rabeya Medical College",
    "type": "private",
    "division": "সিলেট",
    "district": "সিলেট",
    "area": "",
    "established": 1995,
    "seats": 125
  },
  {
    "name": "Gonoshasthaya Samaj Vittik Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1998,
    "seats": 50
  },
  {
    "name": "North East Medical College",
    "type": "private",
    "division": "সিলেট",
    "district": "সিলেট",
    "area": "",
    "established": 1998,
    "seats": 120
  },
  {
    "name": "Holy Family Red Crescent Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2000,
    "seats": 140
  },
  {
    "name": "International Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "গাজীপুর",
    "area": "",
    "established": 2000,
    "seats": 130
  },
  {
    "name": "North Bengal Medical College",
    "type": "private",
    "division": "রাজশাহী",
    "district": "সিরাজগঞ্জ",
    "area": "",
    "established": 2000,
    "seats": 85
  },
  {
    "name": "East West Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2000,
    "seats": 120
  },
  {
    "name": "Kumudini Women's Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "টাঙ্গাইল",
    "area": "",
    "established": 2001,
    "seats": 115
  },
  {
    "name": "Tairunnessa Memorial Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "গাজীপুর",
    "area": "",
    "established": 2002,
    "seats": 107
  },
  {
    "name": "Ibrahim Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2002,
    "seats": 120
  },
  {
    "name": "BGC Trust Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 2002,
    "seats": 120
  },
  {
    "name": "Shahabuddin Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2003,
    "seats": 90
  },
  {
    "name": "Enam Medical College and Hospital",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2003,
    "seats": 155
  },
  {
    "name": "Islami Bank Medical College",
    "type": "private",
    "division": "রাজশাহী",
    "district": "রাজশাহী",
    "area": "",
    "established": 2003,
    "seats": 85
  },
  {
    "name": "Ibn Sina Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2005,
    "seats": 60
  },
  {
    "name": "Central Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "কুমিল্লা",
    "area": "",
    "established": 2005,
    "seats": 75
  },
  {
    "name": "Eastern Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "কুমিল্লা",
    "area": "",
    "established": 2005,
    "seats": 115
  },
  {
    "name": "Khwaja Yunus Ali Medical College",
    "type": "private",
    "division": "রাজশাহী",
    "district": "সিরাজগঞ্জ",
    "area": "",
    "established": 2005,
    "seats": 100
  },
  {
    "name": "Chattagram Maa-O-Shishu Hospital MC",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 2005,
    "seats": 100
  },
  {
    "name": "Sylhet Women's Medical College",
    "type": "private",
    "division": "সিলেট",
    "district": "সিলেট",
    "area": "",
    "established": 2005,
    "seats": 100
  },
  {
    "name": "Southern Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 2006,
    "seats": 65
  },
  {
    "name": "Delta Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2006,
    "seats": 90
  },
  {
    "name": "Uttara Adhunik Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2007,
    "seats": 90
  },
  {
    "name": "Ad-din Women's Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2008,
    "seats": 95
  },
  {
    "name": "Dhaka Community Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2008,
    "seats": 100
  },
  {
    "name": "TMSS Medical College",
    "type": "private",
    "division": "রাজশাহী",
    "district": "বগুড়া",
    "area": "",
    "established": 2008,
    "seats": 145
  },
  {
    "name": "Anwer Khan Modern Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2008,
    "seats": 137
  },
  {
    "name": "Prime Medical College",
    "type": "private",
    "division": "রংপুর",
    "district": "রংপুর",
    "area": "",
    "established": 2008,
    "seats": 130
  },
  {
    "name": "Rangpur Community Medical College",
    "type": "private",
    "division": "রংপুর",
    "district": "রংপুর",
    "area": "",
    "established": 2008,
    "seats": 130
  },
  {
    "name": "Diabetic Association Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ফরিদপুর",
    "area": "",
    "established": 2010,
    "seats": 90
  },
  {
    "name": "Green Life Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2010,
    "seats": 110
  },
  {
    "name": "Popular Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2010,
    "seats": 107
  },
  {
    "name": "MH Samorita Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2010,
    "seats": 115
  },
  {
    "name": "Dhaka Central International Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2011,
    "seats": 90
  },
  {
    "name": "Dr. Sirajul Islam Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2011,
    "seats": 100
  },
  {
    "name": "Marks Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2011,
    "seats": 70
  },
  {
    "name": "Mainamoti Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "কুমিল্লা",
    "area": "",
    "established": 2011,
    "seats": 100
  },
  {
    "name": "Gazi Medical College",
    "type": "private",
    "division": "খুলনা",
    "district": "খুলনা",
    "area": "",
    "established": 2011,
    "seats": 100
  },
  {
    "name": "Barind Medical College",
    "type": "private",
    "division": "রাজশাহী",
    "district": "রাজশাহী",
    "area": "",
    "established": 2011,
    "seats": 100
  },
  {
    "name": "City Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "গাজীপুর",
    "area": "",
    "established": 2011,
    "seats": 80
  },
  {
    "name": "Monno Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "মানিকগঞ্জ",
    "area": "",
    "established": 2012,
    "seats": 80
  },
  {
    "name": "Ad-din Sakina Medical College",
    "type": "private",
    "division": "খুলনা",
    "district": "যশোর",
    "area": "",
    "established": 2012,
    "seats": 70
  },
  {
    "name": "Ashiyan Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2012,
    "seats": 50
  },
  {
    "name": "Aichi Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2013,
    "seats": 50
  },
  {
    "name": "President Abdul Hamid Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "কিশোরগঞ্জ",
    "area": "",
    "established": 2013,
    "seats": 90
  },
  {
    "name": "Universal Medical College and Hospital",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2013,
    "seats": 57
  },
  {
    "name": "Brahmanbaria Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "ব্রাহ্মণবাড়িয়া",
    "area": "",
    "established": 2013,
    "seats": 50
  },
  {
    "name": "Parkview Medical College",
    "type": "private",
    "division": "সিলেট",
    "district": "সিলেট",
    "area": "",
    "established": 2013,
    "seats": 67
  },
  {
    "name": "Chattagram International Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 2013,
    "seats": 50
  },
  {
    "name": "Ad-Din Akij Medical College",
    "type": "private",
    "division": "খুলনা",
    "district": "খুলনা",
    "area": "",
    "established": 2013,
    "seats": 60
  },
  {
    "name": "Bashundhara Ad-din Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "মুন্সিগঞ্জ",
    "area": "",
    "established": 2014,
    "seats": 50
  },
  {
    "name": "Bikrampur Bhuiyan's Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "মুন্সিগঞ্জ",
    "area": "",
    "established": 2014,
    "seats": 61
  },
  {
    "name": "Marine City Medical College",
    "type": "private",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 2014,
    "seats": 50
  },
  {
    "name": "US-Bangla Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "নারায়ণগঞ্জ",
    "area": "",
    "established": 2015,
    "seats": 50
  },
  {
    "name": "Monowara Sikder Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "শরীয়তপুর",
    "area": "",
    "established": 2016,
    "seats": 64
  },
  {
    "name": "Khulna City Medical College",
    "type": "private",
    "division": "খুলনা",
    "district": "খুলনা",
    "area": "",
    "established": 2016,
    "seats": 50
  },
  {
    "name": "United Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2020,
    "seats": 50
  },
  {
    "name": "South Apollo Medical College",
    "type": "private",
    "division": "বরিশাল",
    "district": "বরিশাল",
    "area": "",
    "established": 2021,
    "seats": 50
  },
  {
    "name": "Ahsania Mission Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2021,
    "seats": 50
  },
  {
    "name": "Asgar Ali Medical College",
    "type": "private",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 2024,
    "seats": null
  },
  {
    "name": "Armed Forces Medical College (AFMC)",
    "type": "army",
    "division": "ঢাকা",
    "district": "ঢাকা",
    "area": "",
    "established": 1999,
    "seats": 125
  },
  {
    "name": "Army Medical College, Bogura",
    "type": "army",
    "division": "রাজশাহী",
    "district": "বগুড়া",
    "area": "",
    "established": 2014,
    "seats": 50
  },
  {
    "name": "Army Medical College, Chattogram",
    "type": "army",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 2014,
    "seats": 50
  },
  {
    "name": "Army Medical College, Cumilla",
    "type": "army",
    "division": "চট্টগ্রাম",
    "district": "কুমিল্লা",
    "area": "",
    "established": 2014,
    "seats": 50
  },
  {
    "name": "Army Medical College, Jashore",
    "type": "army",
    "division": "খুলনা",
    "district": "যশোর",
    "area": "",
    "established": 2014,
    "seats": 50
  },
  {
    "name": "Army Medical College, Rangpur",
    "type": "army",
    "division": "রংপুর",
    "district": "রংপুর",
    "area": "",
    "established": 2014,
    "seats": 50
  },
  {
    "name": "Navy Medical College, Chattogram",
    "type": "army",
    "division": "চট্টগ্রাম",
    "district": "চট্টগ্রাম",
    "area": "",
    "established": 2024,
    "seats": 50
  }
];
