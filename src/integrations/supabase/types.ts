export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          ai_prompt_template: string | null
          bias_enabled: boolean
          bias_lookback_days: number
          bias_per_hour_enabled: boolean
          bias_stations: string
          bias_strength: number
          ensemble_enabled: boolean
          ensemble_min_day: number
          id: string
          lightning_enabled: boolean
          lightning_radius_km: number
          location_lat: number | null
          location_lon: number | null
          location_name: string | null
          models_longterm: string | null
          models_midterm: string | null
          models_shortterm: string | null
          mosmix_enabled: boolean
          mosmix_stations: string
          night_clear_cooling_c: number
          nowcast_enabled: boolean
          nowcast_obs_horizon_h: number
          prompt_sky: string | null
          prompt_temp: string | null
          prompt_wind: string | null
          radar_correction_strength: number
          radar_enabled: boolean
          radar_radius_km: number
          radius_km: number | null
          tag0_weight_mosmix: number
          tag0_weight_om: number
          tag1_weight_mosmix: number
          tag1_weight_om: number
          topo_elev_max: number | null
          topo_elev_median: number | null
          topo_elev_min: number | null
          updated_at: string
          updated_by: string | null
          wp_site_url: string | null
          wp_target_page_id: number | null
          wp_target_slug: string | null
          wp_username: string | null
        }
        Insert: {
          ai_prompt_template?: string | null
          bias_enabled?: boolean
          bias_lookback_days?: number
          bias_per_hour_enabled?: boolean
          bias_stations?: string
          bias_strength?: number
          ensemble_enabled?: boolean
          ensemble_min_day?: number
          id?: string
          lightning_enabled?: boolean
          lightning_radius_km?: number
          location_lat?: number | null
          location_lon?: number | null
          location_name?: string | null
          models_longterm?: string | null
          models_midterm?: string | null
          models_shortterm?: string | null
          mosmix_enabled?: boolean
          mosmix_stations?: string
          night_clear_cooling_c?: number
          nowcast_enabled?: boolean
          nowcast_obs_horizon_h?: number
          prompt_sky?: string | null
          prompt_temp?: string | null
          prompt_wind?: string | null
          radar_correction_strength?: number
          radar_enabled?: boolean
          radar_radius_km?: number
          radius_km?: number | null
          tag0_weight_mosmix?: number
          tag0_weight_om?: number
          tag1_weight_mosmix?: number
          tag1_weight_om?: number
          topo_elev_max?: number | null
          topo_elev_median?: number | null
          topo_elev_min?: number | null
          updated_at?: string
          updated_by?: string | null
          wp_site_url?: string | null
          wp_target_page_id?: number | null
          wp_target_slug?: string | null
          wp_username?: string | null
        }
        Update: {
          ai_prompt_template?: string | null
          bias_enabled?: boolean
          bias_lookback_days?: number
          bias_per_hour_enabled?: boolean
          bias_stations?: string
          bias_strength?: number
          ensemble_enabled?: boolean
          ensemble_min_day?: number
          id?: string
          lightning_enabled?: boolean
          lightning_radius_km?: number
          location_lat?: number | null
          location_lon?: number | null
          location_name?: string | null
          models_longterm?: string | null
          models_midterm?: string | null
          models_shortterm?: string | null
          mosmix_enabled?: boolean
          mosmix_stations?: string
          night_clear_cooling_c?: number
          nowcast_enabled?: boolean
          nowcast_obs_horizon_h?: number
          prompt_sky?: string | null
          prompt_temp?: string | null
          prompt_wind?: string | null
          radar_correction_strength?: number
          radar_enabled?: boolean
          radar_radius_km?: number
          radius_km?: number | null
          tag0_weight_mosmix?: number
          tag0_weight_om?: number
          tag1_weight_mosmix?: number
          tag1_weight_om?: number
          topo_elev_max?: number | null
          topo_elev_median?: number | null
          topo_elev_min?: number | null
          updated_at?: string
          updated_by?: string | null
          wp_site_url?: string | null
          wp_target_page_id?: number | null
          wp_target_slug?: string | null
          wp_username?: string | null
        }
        Relationships: []
      }
      forecast_entries: {
        Row: {
          body: string
          created_at: string
          entry_date: string | null
          forecast_id: string
          id: string
          position: number
          title: string
          updated_at: string
          weather_data: Json | null
        }
        Insert: {
          body?: string
          created_at?: string
          entry_date?: string | null
          forecast_id: string
          id?: string
          position: number
          title: string
          updated_at?: string
          weather_data?: Json | null
        }
        Update: {
          body?: string
          created_at?: string
          entry_date?: string | null
          forecast_id?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
          weather_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_entries_forecast_id_fkey"
            columns: ["forecast_id"]
            isOneToOne: false
            referencedRelation: "forecasts"
            referencedColumns: ["id"]
          },
        ]
      }
      forecasts: {
        Row: {
          created_at: string
          created_by: string | null
          forecast_date: string
          id: string
          notes: string | null
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
          wp_post_id: number | null
          wp_post_url: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          forecast_date: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          wp_post_id?: number | null
          wp_post_url?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          forecast_date?: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          wp_post_id?: number | null
          wp_post_url?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weather_cache: {
        Row: {
          cache_key: string
          expires_at: string
          fetched_at: string
          payload: Json
        }
        Insert: {
          cache_key: string
          expires_at: string
          fetched_at?: string
          payload: Json
        }
        Update: {
          cache_key?: string
          expires_at?: string
          fetched_at?: string
          payload?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "editor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor"],
    },
  },
} as const
