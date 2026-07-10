export type TTrainingExperience = {
  years: string;
  students: string;
};

export type TMentor = {
  id: string;
  userId?: any;
  name: string;
  email: string;
  phone: string;
  designation: string;
  subject: string;
  specialized_area: string[];
  education_qualification: string[];
  work_experience: string[];
  training_experience: TTrainingExperience;
  image: string;
  details: string;
  lifeJourney: string;
  createdAt?: Date;
  updatedAt?: Date;
};
