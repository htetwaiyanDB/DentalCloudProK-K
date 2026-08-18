-- Supports branch-scoped appointment lists, day filters, sorting, and 100-row pagination.
CREATE INDEX IF NOT EXISTS appointments_location_date_time_id_idx
ON public.appointments (location_id, date, time, id);

ANALYZE public.appointments;
