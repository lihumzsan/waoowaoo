ALTER TABLE location_images
  ADD COLUMN availableSlots TEXT NULL;

ALTER TABLE global_location_images
  ADD COLUMN availableSlots TEXT NULL;
