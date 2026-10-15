-- Profils manquants. Un compte de connexion créé avant les migrations (premier essai de connexion sur
-- un projet Supabase neuf) n'a pas de profil : le déclencheur on_auth_user_created n'existait pas encore.
-- Sans profil, l'application renvoie à l'écran de connexion juste après une connexion réussie.
-- Rattrapage des données seulement : aucune table, fonction ni droit nouveau ; sans effet s'il n'y a
-- rien à rattraper.
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
