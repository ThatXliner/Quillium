
-- Migration: 20260422000001_initial_schema.sql
-- Purpose: Squashed Quillium Omni schema. Keep Supabase migrations in this
-- repo; relay/landing services should consume this schema rather than keeping
-- duplicate migration files.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "moddatetime" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Anonymous'));
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."collab_snapshots" (
    "id" bigint NOT NULL,
    "document_id" "uuid" NOT NULL,
    "version" bigint NOT NULL,
    "state_json" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."collab_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."collab_snapshots" IS 'Periodic document snapshots for fast state reconstruction - D-41. RLS enabled; relay service_role only.';



COMMENT ON COLUMN "public"."collab_snapshots"."version" IS 'Document version at snapshot creation time';



COMMENT ON COLUMN "public"."collab_snapshots"."state_json" IS 'Full document text at snapshot time (not ChangeSet)';



ALTER TABLE "public"."collab_snapshots" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."collab_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."collab_updates" (
    "id" bigint NOT NULL,
    "document_id" "uuid" NOT NULL,
    "version" bigint NOT NULL,
    "client_id" "text" NOT NULL,
    "changes" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."collab_updates" OWNER TO "postgres";


COMMENT ON TABLE "public"."collab_updates" IS 'Ordered OT updates from @codemirror/collab - DATA-03. RLS enabled; relay service_role only.';



COMMENT ON COLUMN "public"."collab_updates"."version" IS 'Monotonic version assigned by relay server (D-08)';



COMMENT ON COLUMN "public"."collab_updates"."client_id" IS 'Client identifier from @codemirror/collab clientID';



COMMENT ON COLUMN "public"."collab_updates"."changes" IS 'Serialized ChangeSet JSON from CodeMirror';



ALTER TABLE "public"."collab_updates" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."collab_updates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "share_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "permission" "text" DEFAULT 'edit'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shares" OWNER TO "postgres";


COMMENT ON TABLE "public"."shares" IS 'Share tokens for document access (Google Docs style) - DATA-04';



COMMENT ON COLUMN "public"."shares"."share_token" IS 'UUID token used in share links, resetable by owner (D-05)';



COMMENT ON COLUMN "public"."shares"."enabled" IS 'Owner can disable sharing (D-05)';



COMMENT ON COLUMN "public"."shares"."permission" IS 'Reserved for v2 granular permissions, default edit (D-04)';



CREATE TABLE IF NOT EXISTS "public"."sync_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Untitled'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sync_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."sync_documents" IS 'Registry of documents available for sync - DATA-02';



COMMENT ON COLUMN "public"."sync_documents"."owner_id" IS 'Document owner (FK to public.users)';



COMMENT ON COLUMN "public"."sync_documents"."title" IS 'Document title (metadata only, content stored locally)';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "display_name" "text",
    "subscription_status" "text" DEFAULT 'free'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'User profiles extending auth.users - DATA-01';



COMMENT ON COLUMN "public"."users"."display_name" IS 'User display name (D-01: no avatars stored)';



COMMENT ON COLUMN "public"."users"."subscription_status" IS 'Subscription tier: free, pro, etc.';



CREATE TABLE IF NOT EXISTS "public"."yjs_documents" (
    "document_id" "uuid" NOT NULL,
    "state_update" "text" NOT NULL,
    "state_vector" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."yjs_documents" OWNER TO "postgres";


COMMENT ON TABLE "public"."yjs_documents" IS 'Yjs full document state snapshots (base64 encoded). RLS enabled; relay service_role only.';



CREATE TABLE IF NOT EXISTS "public"."yjs_updates" (
    "id" bigint NOT NULL,
    "document_id" "uuid" NOT NULL,
    "update_data" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."yjs_updates" OWNER TO "postgres";


COMMENT ON TABLE "public"."yjs_updates" IS 'Incremental Yjs updates between snapshots. RLS enabled; relay service_role only.';



CREATE SEQUENCE IF NOT EXISTS "public"."yjs_updates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."yjs_updates_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."yjs_updates_id_seq" OWNED BY "public"."yjs_updates"."id";



ALTER TABLE ONLY "public"."yjs_updates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."yjs_updates_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."collab_snapshots"
    ADD CONSTRAINT "collab_snapshots_document_id_version_key" UNIQUE ("document_id", "version");



ALTER TABLE ONLY "public"."collab_snapshots"
    ADD CONSTRAINT "collab_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."collab_updates"
    ADD CONSTRAINT "collab_updates_document_id_version_key" UNIQUE ("document_id", "version");



ALTER TABLE ONLY "public"."collab_updates"
    ADD CONSTRAINT "collab_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shares"
    ADD CONSTRAINT "shares_document_id_key" UNIQUE ("document_id");



ALTER TABLE ONLY "public"."shares"
    ADD CONSTRAINT "shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_documents"
    ADD CONSTRAINT "sync_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."yjs_documents"
    ADD CONSTRAINT "yjs_documents_pkey" PRIMARY KEY ("document_id");



ALTER TABLE ONLY "public"."yjs_updates"
    ADD CONSTRAINT "yjs_updates_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_collab_snapshots_doc_version" ON "public"."collab_snapshots" USING "btree" ("document_id", "version" DESC);



CREATE INDEX "idx_collab_updates_doc_version" ON "public"."collab_updates" USING "btree" ("document_id", "version");



CREATE INDEX "idx_shares_token" ON "public"."shares" USING "btree" ("share_token") WHERE ("enabled" = true);



CREATE INDEX "idx_sync_documents_owner" ON "public"."sync_documents" USING "btree" ("owner_id");



CREATE INDEX "idx_yjs_updates_document_id" ON "public"."yjs_updates" USING "btree" ("document_id", "created_at");



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."shares" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."sync_documents" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



CREATE OR REPLACE TRIGGER "handle_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "extensions"."moddatetime"('updated_at');



ALTER TABLE ONLY "public"."collab_snapshots"
    ADD CONSTRAINT "collab_snapshots_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."sync_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collab_updates"
    ADD CONSTRAINT "collab_updates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."sync_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shares"
    ADD CONSTRAINT "shares_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."sync_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_documents"
    ADD CONSTRAINT "sync_documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."yjs_documents"
    ADD CONSTRAINT "yjs_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."sync_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."yjs_updates"
    ADD CONSTRAINT "yjs_updates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."sync_documents"("id") ON DELETE CASCADE;



CREATE POLICY "Document owners can create share settings" ON "public"."shares" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sync_documents"
  WHERE (("sync_documents"."id" = "shares"."document_id") AND ("sync_documents"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Document owners can delete share settings" ON "public"."shares" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sync_documents"
  WHERE (("sync_documents"."id" = "shares"."document_id") AND ("sync_documents"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Document owners can delete their documents" ON "public"."sync_documents" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Document owners can read share settings" ON "public"."shares" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sync_documents"
  WHERE (("sync_documents"."id" = "shares"."document_id") AND ("sync_documents"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Document owners can read their documents" ON "public"."sync_documents" FOR SELECT TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Document owners can register documents" ON "public"."sync_documents" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Document owners can update share settings" ON "public"."shares" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sync_documents"
  WHERE (("sync_documents"."id" = "shares"."document_id") AND ("sync_documents"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sync_documents"
  WHERE (("sync_documents"."id" = "shares"."document_id") AND ("sync_documents"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Document owners can update their documents" ON "public"."sync_documents" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can create their own profile" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can read their own profile" ON "public"."users" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Users can update their own display name" ON "public"."users" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."collab_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."collab_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."yjs_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."yjs_updates" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


































































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


















GRANT ALL ON TABLE "public"."collab_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."collab_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."collab_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."collab_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."collab_updates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."collab_updates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."collab_updates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."collab_updates_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."shares" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."shares" TO "authenticated";



GRANT ALL ON TABLE "public"."sync_documents" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."sync_documents" TO "authenticated";



GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT SELECT ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("id") ON TABLE "public"."users" TO "authenticated";



GRANT INSERT("display_name"),UPDATE("display_name") ON TABLE "public"."users" TO "authenticated";



GRANT ALL ON TABLE "public"."yjs_documents" TO "service_role";



GRANT ALL ON TABLE "public"."yjs_updates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."yjs_updates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."yjs_updates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."yjs_updates_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();


