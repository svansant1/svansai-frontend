import { storeArtifact, ArtifactPublicationFailure, publicationFailureOutcome } from "./storage";
import type { GeneratedArtifact } from "./types";
import { assertCyberRequestCurrent, type TrustedRequestContext } from "@/lib/platform/request-context";
import { bindCyberJob } from "@/lib/jobs/cyber-context";
import type { JobRecord } from "@/lib/jobs/types";
import { ownerDatabase } from "@/lib/auth/owner-session";
/** Reuse native storage, with a transactional live-grant guard on visible metadata. */
export async function storeContextArtifact(context: TrustedRequestContext, artifact: GeneratedArtifact, job?: Pick<JobRecord, "id" | "lease_token">) {
  return storeArtifact(context.userId, artifact, undefined, {
    assertAuthorized: () => assertCyberRequestCurrent(context),
    publishMetadata: async row => {
      try { await assertCyberRequestCurrent(context); }
      catch { throw new ArtifactPublicationFailure("Protected artifact publication was rejected before dispatch.", "rejected"); }
      const { data, error } = await ownerDatabase().rpc("svans_publish_cyber_artifact", {
        p_user: context.userId, p_binding: bindCyberJob(context), p_row: row,
        p_job: job?.id ?? null, p_lease: job?.lease_token ?? null,
      });
      if (error || !data) throw new ArtifactPublicationFailure("Protected artifact publication was not confirmed. Recheck authorization and storage.", publicationFailureOutcome(error?.code));
      return data;
    },
  });
}
