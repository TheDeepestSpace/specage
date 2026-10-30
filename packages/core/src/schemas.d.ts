import { z } from 'zod';
export declare const ConfigSchema: z.ZodObject<{
    specage_version: z.ZodString;
    project: z.ZodString;
    spec_file: z.ZodString;
    reviewer: z.ZodString;
    intern: z.ZodObject<{
        repo: z.ZodString;
        workflow: z.ZodDefault<z.ZodString>;
        backend: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        repo: string;
        workflow: string;
        backend: string;
    }, {
        repo: string;
        workflow?: string | undefined;
        backend?: string | undefined;
    }>;
    auto_implement: z.ZodDefault<z.ZodBoolean>;
    pages: z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<["gh-pages-subdir", "off"]>>;
        path: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        mode: "gh-pages-subdir" | "off";
    }, {
        path?: string | undefined;
        mode?: "gh-pages-subdir" | "off" | undefined;
    }>;
    ui: z.ZodDefault<z.ZodObject<{
        url: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        url?: string | undefined;
    }, {
        url?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    specage_version: string;
    project: string;
    spec_file: string;
    reviewer: string;
    intern: {
        repo: string;
        workflow: string;
        backend: string;
    };
    auto_implement: boolean;
    pages: {
        path: string;
        mode: "gh-pages-subdir" | "off";
    };
    ui: {
        url?: string | undefined;
    };
}, {
    specage_version: string;
    project: string;
    spec_file: string;
    reviewer: string;
    intern: {
        repo: string;
        workflow?: string | undefined;
        backend?: string | undefined;
    };
    pages: {
        path?: string | undefined;
        mode?: "gh-pages-subdir" | "off" | undefined;
    };
    auto_implement?: boolean | undefined;
    ui?: {
        url?: string | undefined;
    } | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
export declare const PolicySchema: z.ZodObject<{
    reconcile: z.ZodObject<{
        cosmetic: z.ZodObject<{
            early: z.ZodEnum<["refresh", "amend", "ask"]>;
            late: z.ZodEnum<["refresh", "amend", "ask"]>;
        }, "strip", z.ZodTypeAny, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }>;
        refinement: z.ZodObject<{
            early: z.ZodEnum<["refresh", "amend", "ask"]>;
            late: z.ZodEnum<["refresh", "amend", "ask"]>;
        }, "strip", z.ZodTypeAny, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }>;
        addition: z.ZodObject<{
            early: z.ZodEnum<["refresh", "amend", "ask"]>;
            late: z.ZodEnum<["refresh", "amend", "ask"]>;
        }, "strip", z.ZodTypeAny, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }>;
        reversal: z.ZodObject<{
            early: z.ZodEnum<["refresh", "amend", "ask"]>;
            late: z.ZodEnum<["refresh", "amend", "ask"]>;
        }, "strip", z.ZodTypeAny, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }, {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        }>;
        unsure: z.ZodEnum<["refresh", "amend", "ask"]>;
    }, "strip", z.ZodTypeAny, {
        refinement: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        cosmetic: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        addition: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        reversal: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        unsure: "refresh" | "amend" | "ask";
    }, {
        refinement: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        cosmetic: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        addition: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        reversal: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        unsure: "refresh" | "amend" | "ask";
    }>;
    split_items: z.ZodEnum<["refresh", "amend", "ask"]>;
}, "strip", z.ZodTypeAny, {
    reconcile: {
        refinement: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        cosmetic: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        addition: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        reversal: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        unsure: "refresh" | "amend" | "ask";
    };
    split_items: "refresh" | "amend" | "ask";
}, {
    reconcile: {
        refinement: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        cosmetic: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        addition: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        reversal: {
            early: "refresh" | "amend" | "ask";
            late: "refresh" | "amend" | "ask";
        };
        unsure: "refresh" | "amend" | "ask";
    };
    split_items: "refresh" | "amend" | "ask";
}>;
export type Policy = z.infer<typeof PolicySchema>;
export declare const Hash: z.ZodString;
export declare const EvidenceSchema: z.ZodObject<{
    kind: z.ZodString;
    ref: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, string, string | number>;
    commit: z.ZodOptional<z.ZodString>;
    tier: z.ZodOptional<z.ZodEnum<["tested", "located", "asserted"]>>;
    inherited: z.ZodOptional<z.ZodBoolean>;
    url: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    kind: string;
    ref: string;
    url?: string | undefined;
    commit?: string | undefined;
    tier?: "tested" | "located" | "asserted" | undefined;
    inherited?: boolean | undefined;
}, {
    kind: string;
    ref: string | number;
    url?: string | undefined;
    commit?: string | undefined;
    tier?: "tested" | "located" | "asserted" | undefined;
    inherited?: boolean | undefined;
}>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export declare const TraceNodeSchema: z.ZodObject<{
    spec_hash: z.ZodString;
    status: z.ZodEnum<["planned", "in_progress", "implemented", "contradiction", "absent"]>;
    evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        ref: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, string, string | number>;
        commit: z.ZodOptional<z.ZodString>;
        tier: z.ZodOptional<z.ZodEnum<["tested", "located", "asserted"]>>;
        inherited: z.ZodOptional<z.ZodBoolean>;
        url: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        kind: string;
        ref: string;
        url?: string | undefined;
        commit?: string | undefined;
        tier?: "tested" | "located" | "asserted" | undefined;
        inherited?: boolean | undefined;
    }, {
        kind: string;
        ref: string | number;
        url?: string | undefined;
        commit?: string | undefined;
        tier?: "tested" | "located" | "asserted" | undefined;
        inherited?: boolean | undefined;
    }>, "many">>;
    verified: z.ZodOptional<z.ZodObject<{
        by: z.ZodString;
        at: z.ZodString;
        hash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        hash: string;
        at: string;
        by: string;
    }, {
        hash: string;
        at: string;
        by: string;
    }>>;
    discovered: z.ZodOptional<z.ZodObject<{
        dispatch: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        dispatch: string;
    }, {
        dispatch: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    status: "planned" | "in_progress" | "implemented" | "contradiction" | "absent";
    spec_hash: string;
    evidence: {
        kind: string;
        ref: string;
        url?: string | undefined;
        commit?: string | undefined;
        tier?: "tested" | "located" | "asserted" | undefined;
        inherited?: boolean | undefined;
    }[];
    verified?: {
        hash: string;
        at: string;
        by: string;
    } | undefined;
    discovered?: {
        dispatch: string;
    } | undefined;
}, {
    status: "planned" | "in_progress" | "implemented" | "contradiction" | "absent";
    spec_hash: string;
    evidence?: {
        kind: string;
        ref: string | number;
        url?: string | undefined;
        commit?: string | undefined;
        tier?: "tested" | "located" | "asserted" | undefined;
        inherited?: boolean | undefined;
    }[] | undefined;
    verified?: {
        hash: string;
        at: string;
        by: string;
    } | undefined;
    discovered?: {
        dispatch: string;
    } | undefined;
}>;
export declare const TraceSchema: z.ZodObject<{
    retired_ids: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** IDs whose `<-` clause has been consumed by a dispatch (drives lint W105) */
    consumed_lineage: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    nodes: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        spec_hash: z.ZodString;
        status: z.ZodEnum<["planned", "in_progress", "implemented", "contradiction", "absent"]>;
        evidence: z.ZodDefault<z.ZodArray<z.ZodObject<{
            kind: z.ZodString;
            ref: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, string, string | number>;
            commit: z.ZodOptional<z.ZodString>;
            tier: z.ZodOptional<z.ZodEnum<["tested", "located", "asserted"]>>;
            inherited: z.ZodOptional<z.ZodBoolean>;
            url: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            kind: string;
            ref: string;
            url?: string | undefined;
            commit?: string | undefined;
            tier?: "tested" | "located" | "asserted" | undefined;
            inherited?: boolean | undefined;
        }, {
            kind: string;
            ref: string | number;
            url?: string | undefined;
            commit?: string | undefined;
            tier?: "tested" | "located" | "asserted" | undefined;
            inherited?: boolean | undefined;
        }>, "many">>;
        verified: z.ZodOptional<z.ZodObject<{
            by: z.ZodString;
            at: z.ZodString;
            hash: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            hash: string;
            at: string;
            by: string;
        }, {
            hash: string;
            at: string;
            by: string;
        }>>;
        discovered: z.ZodOptional<z.ZodObject<{
            dispatch: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            dispatch: string;
        }, {
            dispatch: string;
        }>>;
    }, "strip", z.ZodTypeAny, {
        status: "planned" | "in_progress" | "implemented" | "contradiction" | "absent";
        spec_hash: string;
        evidence: {
            kind: string;
            ref: string;
            url?: string | undefined;
            commit?: string | undefined;
            tier?: "tested" | "located" | "asserted" | undefined;
            inherited?: boolean | undefined;
        }[];
        verified?: {
            hash: string;
            at: string;
            by: string;
        } | undefined;
        discovered?: {
            dispatch: string;
        } | undefined;
    }, {
        status: "planned" | "in_progress" | "implemented" | "contradiction" | "absent";
        spec_hash: string;
        evidence?: {
            kind: string;
            ref: string | number;
            url?: string | undefined;
            commit?: string | undefined;
            tier?: "tested" | "located" | "asserted" | undefined;
            inherited?: boolean | undefined;
        }[] | undefined;
        verified?: {
            hash: string;
            at: string;
            by: string;
        } | undefined;
        discovered?: {
            dispatch: string;
        } | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    retired_ids: string[];
    consumed_lineage: string[];
    nodes: Record<string, {
        status: "planned" | "in_progress" | "implemented" | "contradiction" | "absent";
        spec_hash: string;
        evidence: {
            kind: string;
            ref: string;
            url?: string | undefined;
            commit?: string | undefined;
            tier?: "tested" | "located" | "asserted" | undefined;
            inherited?: boolean | undefined;
        }[];
        verified?: {
            hash: string;
            at: string;
            by: string;
        } | undefined;
        discovered?: {
            dispatch: string;
        } | undefined;
    }>;
}, {
    retired_ids?: string[] | undefined;
    consumed_lineage?: string[] | undefined;
    nodes?: Record<string, {
        status: "planned" | "in_progress" | "implemented" | "contradiction" | "absent";
        spec_hash: string;
        evidence?: {
            kind: string;
            ref: string | number;
            url?: string | undefined;
            commit?: string | undefined;
            tier?: "tested" | "located" | "asserted" | undefined;
            inherited?: boolean | undefined;
        }[] | undefined;
        verified?: {
            hash: string;
            at: string;
            by: string;
        } | undefined;
        discovered?: {
            dispatch: string;
        } | undefined;
    }> | undefined;
}>;
export type Trace = z.infer<typeof TraceSchema>;
export declare const WorkItemSchema: z.ZodObject<{
    id: z.ZodString;
    issue: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    pr: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    state: z.ZodEnum<["filed", "in_progress", "in_review", "merged", "closed"]>;
    relations: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodObject<{
        supersedes: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        supersedes: string;
    }, {
        supersedes: string;
    }>, z.ZodObject<{
        stacked_on: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        stacked_on: string;
    }, {
        stacked_on: string;
    }>, z.ZodObject<{
        follows: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        follows: string;
    }, {
        follows: string;
    }>]>, "many">>;
    claims: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        hash: z.ZodString;
        status: z.ZodEnum<["pending", "done"]>;
    }, "strip", z.ZodTypeAny, {
        hash: string;
        status: "pending" | "done";
    }, {
        hash: string;
        status: "pending" | "done";
    }>>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    issue: number | null;
    pr: number | null;
    state: "in_progress" | "filed" | "in_review" | "merged" | "closed";
    relations: ({
        supersedes: string;
    } | {
        stacked_on: string;
    } | {
        follows: string;
    })[];
    claims: Record<string, {
        hash: string;
        status: "pending" | "done";
    }>;
}, {
    id: string;
    state: "in_progress" | "filed" | "in_review" | "merged" | "closed";
    issue?: number | null | undefined;
    pr?: number | null | undefined;
    relations?: ({
        supersedes: string;
    } | {
        stacked_on: string;
    } | {
        follows: string;
    })[] | undefined;
    claims?: Record<string, {
        hash: string;
        status: "pending" | "done";
    }> | undefined;
}>;
export declare const WorkSchema: z.ZodObject<{
    items: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        issue: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        pr: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        state: z.ZodEnum<["filed", "in_progress", "in_review", "merged", "closed"]>;
        relations: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodObject<{
            supersedes: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            supersedes: string;
        }, {
            supersedes: string;
        }>, z.ZodObject<{
            stacked_on: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            stacked_on: string;
        }, {
            stacked_on: string;
        }>, z.ZodObject<{
            follows: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            follows: string;
        }, {
            follows: string;
        }>]>, "many">>;
        claims: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
            hash: z.ZodString;
            status: z.ZodEnum<["pending", "done"]>;
        }, "strip", z.ZodTypeAny, {
            hash: string;
            status: "pending" | "done";
        }, {
            hash: string;
            status: "pending" | "done";
        }>>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        issue: number | null;
        pr: number | null;
        state: "in_progress" | "filed" | "in_review" | "merged" | "closed";
        relations: ({
            supersedes: string;
        } | {
            stacked_on: string;
        } | {
            follows: string;
        })[];
        claims: Record<string, {
            hash: string;
            status: "pending" | "done";
        }>;
    }, {
        id: string;
        state: "in_progress" | "filed" | "in_review" | "merged" | "closed";
        issue?: number | null | undefined;
        pr?: number | null | undefined;
        relations?: ({
            supersedes: string;
        } | {
            stacked_on: string;
        } | {
            follows: string;
        })[] | undefined;
        claims?: Record<string, {
            hash: string;
            status: "pending" | "done";
        }> | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    items: {
        id: string;
        issue: number | null;
        pr: number | null;
        state: "in_progress" | "filed" | "in_review" | "merged" | "closed";
        relations: ({
            supersedes: string;
        } | {
            stacked_on: string;
        } | {
            follows: string;
        })[];
        claims: Record<string, {
            hash: string;
            status: "pending" | "done";
        }>;
    }[];
}, {
    items?: {
        id: string;
        state: "in_progress" | "filed" | "in_review" | "merged" | "closed";
        issue?: number | null | undefined;
        pr?: number | null | undefined;
        relations?: ({
            supersedes: string;
        } | {
            stacked_on: string;
        } | {
            follows: string;
        })[] | undefined;
        claims?: Record<string, {
            hash: string;
            status: "pending" | "done";
        }> | undefined;
    }[] | undefined;
}>;
export type Work = z.infer<typeof WorkSchema>;
export declare const QuestionSchema: z.ZodObject<{
    id: z.ZodString;
    node: z.ZodString;
    node_hash: z.ZodString;
    dispatch: z.ZodString;
    kind: z.ZodEnum<["ambiguity", "contradiction", "reconcile", "rename", "split"]>;
    text: z.ZodString;
    options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    state: z.ZodEnum<["open", "addressed", "resolved", "withdrawn"]>;
    answer: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    text: string;
    kind: "reconcile" | "contradiction" | "ambiguity" | "rename" | "split";
    dispatch: string;
    state: "open" | "addressed" | "resolved" | "withdrawn";
    node: string;
    node_hash: string;
    answer: string | null;
    options?: string[] | undefined;
}, {
    id: string;
    text: string;
    kind: "reconcile" | "contradiction" | "ambiguity" | "rename" | "split";
    dispatch: string;
    state: "open" | "addressed" | "resolved" | "withdrawn";
    node: string;
    node_hash: string;
    options?: string[] | undefined;
    answer?: string | null | undefined;
}>;
export declare const QuestionsSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    node: z.ZodString;
    node_hash: z.ZodString;
    dispatch: z.ZodString;
    kind: z.ZodEnum<["ambiguity", "contradiction", "reconcile", "rename", "split"]>;
    text: z.ZodString;
    options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    state: z.ZodEnum<["open", "addressed", "resolved", "withdrawn"]>;
    answer: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    text: string;
    kind: "reconcile" | "contradiction" | "ambiguity" | "rename" | "split";
    dispatch: string;
    state: "open" | "addressed" | "resolved" | "withdrawn";
    node: string;
    node_hash: string;
    answer: string | null;
    options?: string[] | undefined;
}, {
    id: string;
    text: string;
    kind: "reconcile" | "contradiction" | "ambiguity" | "rename" | "split";
    dispatch: string;
    state: "open" | "addressed" | "resolved" | "withdrawn";
    node: string;
    node_hash: string;
    options?: string[] | undefined;
    answer?: string | null | undefined;
}>, "many">;
export type Question = z.infer<typeof QuestionSchema>;
export declare const OutboxSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<["implement", "amend", "answer", "continue"]>;
    target: z.ZodNumber;
    body: z.ZodString;
    created: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    kind: "amend" | "answer" | "implement" | "continue";
    target: number;
    body: string;
    created: string;
}, {
    id: string;
    kind: "amend" | "answer" | "implement" | "continue";
    target: number;
    body: string;
    created: string;
}>;
export type OutboxEntry = z.infer<typeof OutboxSchema>;
export interface State {
    trace: Trace;
    work: Work;
    questions: Question[];
}
