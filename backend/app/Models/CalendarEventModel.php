<?php

namespace App\Models;

/**
 * Super-admin calendar events (reminders, demos, meetings).
 */
class CalendarEventModel extends BaseModel
{
    protected $table         = 'calendar_events';
    protected $primaryKey    = 'id';
    protected $allowedFields = [
        'title', 'description', 'event_date', 'start_time', 'end_time',
        'color', 'created_by',
    ];

    protected $useSoftDeletes = true;
    protected $deletedField   = 'deleted_at';

    protected $validationRules = [
        'title'      => 'required|min_length[1]|max_length[255]',
        'event_date' => 'required|valid_date[Y-m-d]',
    ];
}
