<?php

namespace App\Models;

/**
 * A timed reminder against a lead. Once `remind_at` passes, the client's
 * notification poll materialises it into an app notification (stamping
 * `notified_at` so it fires only once). Soft-deletable.
 */
class LeadReminderModel extends TenantModel
{
    protected $table         = 'lead_reminders';
    protected $primaryKey    = 'id';
    protected $allowedFields = ['client_id', 'lead_id', 'user_id', 'author_staff_id', 'remind_at', 'note', 'notified_at', 'done'];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'client_id' => 'required|is_natural_no_zero',
        'lead_id'   => 'required|is_natural_no_zero',
        'remind_at' => 'required',
    ];
}
