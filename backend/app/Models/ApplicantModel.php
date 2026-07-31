<?php

namespace App\Models;

/**
 * The client's OWN applicant records — a client-defined table whose COLUMNS the
 * client designs themselves (stored in the `applicant_columns` setting). Each row
 * keeps its values in a JSON `data` column, plus a `search_blob` for LIKE search.
 * Lives in the client's tenant DB (mirrored via TenantSchema / `tenants:sync`).
 */
class ApplicantModel extends TenantModel
{
    protected $table         = 'applicants';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'data', 'search_blob'];

    protected $useTimestamps  = true;
    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
    ];
}
