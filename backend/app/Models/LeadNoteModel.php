<?php

namespace App\Models;

/** A free-text note against a lead. Soft-deletable. */
class LeadNoteModel extends TenantModel
{
    protected $table         = 'lead_notes';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'lead_id', 'author_id', 'author_name', 'body'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'lead_id'   => 'required|is_natural_no_zero',
        'body'      => 'required',
    ];
}
